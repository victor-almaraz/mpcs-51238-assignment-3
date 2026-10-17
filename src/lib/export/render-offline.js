/*
 * Offline export render (a3-audio-implementation.md, Offline export): the
 * project renders in an OfflineAudioContext through the same worklet graph,
 * engine → safety → destination, with everything the engine needs in
 * processorOptions. No AudioContext is created; fixed seeds and fresh state
 * make repeated exports bit-identical.
 */
import { compileModel } from '../audio/compile-model.js';
import { decodeBytes, getSource } from '../audio/decode.js';
import { ensureModule } from '../audio/engine-client.js';
import { mipsFor } from '../audio/peaks-client.js';
import { deviceSource } from '../project/clip-commands.js';
import { CHANNELS, ENGINE_PROCESSOR, SAFETY_PROCESSOR } from '../../dsp/core/constants.js';

/** Longest export range and tail, s (project limits). */
export const MAX_EXPORT_S = 600;
export const MAX_TAIL_S = 10;
export const DEFAULT_TAIL_S = 2;
export const RANGE_TOO_LONG = 'Export ranges are limited to 10 minutes.';
/** Project seed shared with live playback (init message). */
const EXPORT_ENGINE_SEED = 1;

/** Names of the audio clips whose source is not loaded; they render as silence. */
export function silentClips(doc) {
  return Object.values(doc.clips)
    .filter((c) => c.kind === 'audio' && !getSource(c.sourceId))
    .map((c) => c.name);
}

/**
 * The frame range to export: { start, end, tail, total } for range 'project'
 * ([0, project end)) or 'loop' (`loop` = { start, end } in ticks), plus
 * `tailS` seconds. Fails with RANGE_TOO_LONG past 10 minutes.
 */
export function exportFrames(doc, fs, { range, loop, tailS }) {
  const { model, tempo } = compileModel(doc, fs);
  const start = range === 'loop' ? tempo.frameAt(loop.start) : 0;
  const end = range === 'loop' ? tempo.frameAt(loop.end) : model.endFrame;
  if (end - start > MAX_EXPORT_S * fs) return { ok: false, error: RANGE_TOO_LONG };
  const tail = Math.round(Math.min(MAX_TAIL_S, Math.max(0, tailS)) * fs);
  return { ok: true, value: { model, start, end, tail, total: end - start + tail } };
}

/** Channel copies of every loaded project source at `fs`, decoding again where the rate differs. */
async function sourcesAt(doc, fs) {
  const out = [];
  const ids = new Set(Object.keys(doc.sources));
  for (const d of Object.values(doc.devices)) {
    const ref = deviceSource(d);
    if (ref) ids.add(ref.sourceId);
  }
  for (const id of ids) {
    const source = getSource(id);
    if (!source) continue;
    const channels = source.rate === fs ? source.channels.map((c) => c.slice()) : (await decodeBytes(await source.bytes.arrayBuffer(), fs)).channels;
    out.push({ sourceId: id, channels });
  }
  return out;
}

/**
 * Renders `doc` at `fs`. `options`: { range, loop, tailS, masterVolumeDb,
 * onProgress(fraction | null) }. Resolves to { ok: true, value: { left,
 * right, fs } } or { ok: false, error } with user-facing text.
 */
export async function renderOffline(doc, fs, { range = 'project', loop, tailS = DEFAULT_TAIL_S, masterVolumeDb = -12, onProgress = () => {} }) {
  const frames = exportFrames(doc, fs, { range, loop, tailS });
  if (!frames.ok) return frames;
  const { model, start, total } = frames.value;
  const sources = await sourcesAt(doc, fs);
  const zones = Object.values(doc.devices)
    .filter((d) => d.type === 'sampler' || d.type === 'granular')
    .map((d) => {
      const ref = deviceSource(d);
      return { deviceId: d.id, type: d.type, zone: ref ? { sourceId: ref.sourceId, sourceName: ref.sourceName ?? '' } : null };
    });
  const mips = [];
  for (const z of zones) {
    if (z.type !== 'sampler') continue;
    const s = z.zone && sources.find((x) => x.sourceId === z.zone.sourceId);
    if (s && !mips.some((m) => m.sourceId === s.sourceId)) {
      const levels = await mipsFor(s.sourceId, s.channels);
      if (levels) mips.push({ sourceId: s.sourceId, levels });
    }
  }
  const ctx = new OfflineAudioContext({ numberOfChannels: CHANNELS, length: total, sampleRate: fs });
  await ensureModule(ctx);
  const engine = new AudioWorkletNode(ctx, ENGINE_PROCESSOR, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [CHANNELS],
    processorOptions: { offline: true, seed: EXPORT_ENGINE_SEED, model, sources, mips, zones, masterVolumeDb, startFrame: start, totalFrames: total },
  });
  const safety = new AudioWorkletNode(ctx, SAFETY_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [CHANNELS],
    channelCount: CHANNELS,
    channelCountMode: 'explicit',
    processorOptions: { offline: true },
  });
  engine.connect(safety).connect(ctx.destination);
  let failure = null;
  engine.port.onmessage = (event) => {
    const msg = event.data;
    if (msg.t === 'progress') onProgress(Math.min(1, msg.renderedFrames / msg.totalFrames));
    else if (msg.t === 'error') failure = `The export could not start (${msg.code}).`;
  };
  onProgress(null);
  const buffer = await ctx.startRendering();
  engine.port.onmessage = null;
  if (failure) return { ok: false, error: failure };
  return { ok: true, value: { left: buffer.getChannelData(0), right: buffer.getChannelData(1), fs } };
}
