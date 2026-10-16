import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClipTrack, renderClips, bindSources, STOP_FADE_FRAMES } from '../../src/dsp/clips/clip-player.js';
import { curveIndex, fadeInGain, fadeOutGain } from '../../src/dsp/clips/fades.js';
import { envelopeAt } from '../../src/dsp/clips/gain-envelope.js';
import { Engine } from '../../src/dsp/engine/engine.js';
import { validateEngineMessage, validateModel } from '../../src/dsp/protocol.js';
import { compileModel } from '../../src/lib/audio/compile-model.js';
import { engineTrackIds, paramChanges } from '../../src/lib/audio/param-changes.js';
import {
  addAudioClip,
  addAudioTrack,
  addEnvelopePoint,
  clipEndTick,
  envelopeGainAt,
  deleteClip,
  duplicateClip,
  joinBlocker,
  joinClips,
  moveClip,
  renameClip,
  setClipColor,
  setClipGain,
  setFade,
  splitClip,
  trimEnd,
  trimStart,
} from '../../src/lib/project/clip-commands.js';
import { createProject, setTempo, setTrack } from '../../src/lib/project/model.js';
import { peak } from '../support/signal.js';

const FS = 48000;
const FRAMES_PER_TICK = 25; // 120 BPM, PPQ 960, 48 kHz

function ids() {
  let n = 0;
  return (prefix) => `${prefix}_${++n}`;
}

/** A deterministic test signal: a 441 Hz sine with a slow ramp, `frames` long. */
function tone(frames, phase = 0) {
  const ch = new Float32Array(frames);
  for (let i = 0; i < frames; i++) ch[i] = 0.5 * Math.sin((2 * Math.PI * 441 * i) / FS + phase) * (0.5 + i / (2 * frames));
  return ch;
}

const SOURCE = { sourceId: 'src_a', name: 'tone.wav', mimeType: 'audio/wav', frames: 96000, rate: FS, channels: [null] };

function docWithClip(makeId = ids()) {
  const doc = createProject({ name: 'Clips', tempo: 120, timeSignature: '4/4', now: 0, makeId });
  const added = addAudioClip(doc, { trackId: null, tick: 0, source: SOURCE }, makeId);
  assert.ok(added.ok);
  return { doc: added.doc, clipId: added.clipId, trackId: added.trackId, makeId };
}

/** Renders `frames` frames of `doc` from frame 0 with source channels `channels` bound. */
function render(doc, channels, frames) {
  const engine = new Engine(FS);
  engine.setModel(engine.prepareModel(compileModel(doc, FS).model));
  engine.addSource(SOURCE.sourceId, channels);
  engine.setMasterVolume(0);
  engine.master.snap(engine.master.target);
  engine.play(0);
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let off = 0; off < frames; off += 128) engine.process(l, r, off, Math.min(frames, off + 128));
  return [l, r];
}

test('addAudioClip creates an audio track, a SourceRef and a whole-source clip', () => {
  const { doc, clipId, trackId } = docWithClip();
  assert.equal(doc.tracks[trackId].kind, 'audio');
  assert.equal(doc.tracks[trackId].name, 'tone');
  assert.equal(doc.audioRate, FS);
  assert.deepEqual(doc.sources.src_a, {
    id: 'src_a', name: 'tone.wav', path: 'audio/src_a.wav', sampleRate: FS, channels: 1, frames: 96000, format: 'audio/wav', sha256: 'src_a',
  });
  const clip = doc.clips[clipId];
  assert.equal(clip.sourceOffset, 0);
  assert.equal(clip.sourceLength, 96000);
  assert.equal(clipEndTick(doc, clip), 96000 / FRAMES_PER_TICK);
  assert.deepEqual(engineTrackIds(doc).length, 2);
});

test('split then join restores the identical clip', () => {
  const { doc, clipId, makeId } = docWithClip();
  const withFades = setFade(setFade(doc, clipId, 'fadeIn', 480, 'exp').doc, clipId, 'fadeOut', 960, 'equalPower').doc;
  const enveloped = addEnvelopePoint(addEnvelopePoint(withFades, clipId, 100, 0.5).doc, clipId, 60000, 1.5).doc;
  const split = splitClip(enveloped, clipId, 1001, makeId);
  assert.ok(split.ok);
  const left = split.doc.clips[split.leftId];
  const right = split.doc.clips[split.rightId];
  assert.equal(left.sourceLength, 1001 * FRAMES_PER_TICK);
  assert.equal(right.start, 1001);
  assert.equal(right.sourceOffset, 1001 * FRAMES_PER_TICK);
  assert.equal(left.sourceLength + right.sourceLength, 96000);
  assert.equal(joinBlocker(split.doc, split.leftId, split.rightId), null);
  const joined = joinClips(split.doc, split.leftId, split.rightId);
  assert.ok(joined.ok);
  assert.deepEqual(joined.doc.clips, enveloped.clips);
  assert.deepEqual(joined.doc.tracks, enveloped.tracks);
  assert.deepEqual(joined.doc.sources, enveloped.sources);
});

test('a split clip renders the same as the unsplit clip, envelope and fades included', () => {
  const { doc, clipId, makeId } = docWithClip();
  let shaped = setClipGain(setFade(doc, clipId, 'fadeIn', 4000, 'linear').doc, clipId, -3).doc;
  shaped = setFade(shaped, clipId, 'fadeOut', 3000, 'exp').doc;
  // A segment from frame 10000 to 30000 crosses the split at frame 25025.
  shaped = addEnvelopePoint(shaped, clipId, 10000, 0.2, makeId).doc;
  shaped = addEnvelopePoint(shaped, clipId, 30000, 1.4, makeId).doc;
  const split = splitClip(shaped, clipId, 1001, makeId).doc; // frame 25025, inside a block
  const channels = [tone(96000)];
  const [al, ar] = render(shaped, channels, 96000);
  const [bl, br] = render(split, channels, 96000);
  assert.ok(peak(al) > 0.05);
  assert.deepEqual(bl, al);
  assert.deepEqual(br, ar);
});

test('join is refused for clips that do not continue each other', () => {
  const { doc, clipId, makeId } = docWithClip();
  const split = splitClip(doc, clipId, 1000, makeId);
  const moved = moveClip(split.doc, split.rightId, 10).doc;
  assert.match(joinBlocker(moved, split.leftId, split.rightId), /must touch/);
  const trimmed = trimStart(split.doc, split.rightId, 100).doc;
  assert.match(joinBlocker(trimmed, split.leftId, split.rightId), /does not continue/);
});

test('trim start and end follow the edit math and limits', () => {
  const { doc, clipId } = docWithClip();
  const t = trimStart(doc, clipId, 2500).doc.clips[clipId];
  assert.equal(t.sourceOffset, 2500);
  assert.equal(t.sourceLength, 96000 - 2500);
  assert.equal(t.start, 100);
  const back = trimStart(doc, clipId, -500).doc.clips[clipId]; // cannot go before the source start
  assert.equal(back.sourceOffset, 0);
  const short = trimEnd(doc, clipId, -96000).doc.clips[clipId];
  assert.equal(short.sourceLength, 64);
  const long = trimEnd(trimStart(doc, clipId, 2500).doc, clipId, 10000).doc.clips[clipId];
  assert.equal(long.sourceLength, 96000 - 2500);
});

test('move keeps clips on tracks of their kind; delete drops unused sources', () => {
  const { doc, clipId, trackId, makeId } = docWithClip();
  const instrumentId = doc.trackOrder[0];
  assert.equal(moveClip(doc, clipId, 0, instrumentId).ok, false);
  const second = addAudioTrack(doc, 'Second', makeId);
  const moved = moveClip(second.doc, clipId, 960, second.trackId);
  assert.ok(moved.ok);
  assert.deepEqual(moved.doc.tracks[trackId].clipIds, []);
  assert.deepEqual(moved.doc.tracks[second.trackId].clipIds, [clipId]);
  assert.equal(moved.doc.clips[clipId].start, 960);
  const dup = duplicateClip(doc, clipId, makeId);
  assert.equal(dup.doc.clips[dup.clipId].start, clipEndTick(doc, doc.clips[clipId]));
  assert.ok(deleteClip(dup.doc, clipId).doc.sources.src_a);
  const gone = deleteClip(doc, clipId).doc;
  assert.deepEqual(gone.sources, {});
});

test('rename and colour validate their input', () => {
  const { doc, clipId } = docWithClip();
  assert.equal(renameClip(doc, clipId, '  Verse  ').doc.clips[clipId].name, 'Verse');
  assert.equal(renameClip(doc, clipId, ' ').ok, false);
  assert.equal(setClipColor(doc, clipId, '#1659b5').doc.clips[clipId].color, '#1659b5');
  assert.equal(setClipColor(doc, clipId, 'blue').ok, false);
});

test('fade gains: fade-in from 0, fade-out to near 0, equalPower overlap sums to unit power', () => {
  const ep = curveIndex('equalPower');
  assert.equal(fadeInGain(curveIndex('linear'), 0, 100), 0);
  assert.equal(fadeInGain(curveIndex('linear'), 100, 100), 1);
  assert.equal(fadeOutGain(curveIndex('linear'), 0, 1000, 100), 1);
  for (let p = 0; p < 200; p += 7) {
    const a = fadeOutGain(ep, 800 + p, 1000, 200);
    const b = fadeInGain(ep, p, 200);
    assert.ok(Math.abs(a * a + b * b - 1) < 1e-4, `power at ${p}: ${a * a + b * b}`);
  }
});

test('envelopes interpolate linearly and hold outside their points', () => {
  const frames = Int32Array.from([100, 200]);
  const gains = Float32Array.from([0, 1]);
  assert.equal(envelopeAt(frames, gains, 0), 0);
  assert.ok(Math.abs(envelopeAt(frames, gains, 150) - 0.5) < 1e-9);
  assert.equal(envelopeAt(frames, gains, 500), 1);
  assert.equal(envelopeAt(new Int32Array(0), new Float32Array(0), 5), 1);
});

test('compile sets equalPower crossfades on overlapping clips', () => {
  const { doc, clipId, trackId, makeId } = docWithClip();
  const second = addAudioClip(doc, { trackId, tick: 3000, source: SOURCE }, makeId).doc; // starts inside the first
  const track = compileModel(second, FS).model.tracks[1];
  assert.equal(validateModel(compileModel(second, FS).model), null);
  const overlap = 96000 - 3000 * FRAMES_PER_TICK;
  assert.equal(track.clips.fadeOut[0], overlap);
  assert.equal(track.clips.fadeIn[1], overlap);
  assert.equal(track.clips.fadeOutCurve[0], curveIndex('equalPower'));
  assert.equal(second.clips[clipId].fadeOut.length, 0); // the document is unchanged
});

test('audio frames scale from audioRate to the context rate', () => {
  const { doc } = docWithClip();
  const clips = compileModel(doc, 44100).model.tracks[1].clips;
  assert.equal(clips.length[0], 88200);
});

test('protocol validates audio tracks and source messages', () => {
  const { doc } = docWithClip();
  const model = compileModel(doc, FS).model;
  assert.equal(validateModel(model), null);
  model.tracks[1].clips.source[0] = 3;
  assert.equal(validateModel(model), 'bad-clip');
  const ok = { t: 'source-add', v: 1, sourceId: 'x', channels: [new Float32Array(4), new Float32Array(4)] };
  assert.equal(validateEngineMessage(ok), null);
  assert.equal(validateEngineMessage({ ...ok, channels: [new Float32Array(4), new Float32Array(3)] }), 'bad-channels');
  assert.equal(validateEngineMessage({ t: 'source-remove', v: 1, sourceId: 'x' }), null);
});

test('a clip is silent until its source binds, and stereo sources play on both sides', () => {
  const { doc } = docWithClip();
  const engine = new Engine(FS);
  engine.setModel(engine.prepareModel(compileModel(doc, FS).model));
  engine.play(0);
  const l = new Float32Array(128);
  const r = new Float32Array(128);
  engine.process(l, r, 0, 128);
  assert.equal(peak(l), 0);
  engine.addSource(SOURCE.sourceId, [tone(96000), tone(96000, 1)]);
  engine.process(l, r, 0, 128);
  assert.ok(peak(l) > 0 && peak(r) > 0);
  engine.removeSource(SOURCE.sourceId);
  engine.process(l, r, 0, 128);
  assert.equal(peak(l), 0);
});

test('stop fades a playing clip over 64 frames instead of cutting it', () => {
  const payload = compileModel(docWithClip().doc, FS).model.tracks[1];
  const track = createClipTrack(payload, FS);
  bindSources(track, new Map([[SOURCE.sourceId, [new Float32Array(96000).fill(0.5)]]]));
  const mono = new Float32Array(128);
  const l = new Float32Array(128);
  const r = new Float32Array(128);
  renderClips(track, mono, l, r, 128, 1000, true);
  assert.equal(mono[127], 0.5);
  track.tail = STOP_FADE_FRAMES;
  track.tailFrame = 1128;
  renderClips(track, mono, l, r, 128, 1128, false);
  assert.equal(mono[0], 0.5);
  assert.ok(mono[32] < 0.5 && mono[32] > 0);
  assert.equal(mono[STOP_FADE_FRAMES], 0);
});

test('track mixer edits on audio tracks are params, not a new model', () => {
  const { doc, trackId } = docWithClip();
  const next = setTrack(doc, trackId, { gainDb: -6 });
  assert.deepEqual(paramChanges(doc, next), [1, 0, -6]);
});

test('split refuses points inside a fade', () => {
  const { doc, clipId } = docWithClip();
  const faded = setFade(doc, clipId, 'fadeIn', 30000, 'linear').doc;
  assert.match(splitClip(faded, clipId, 1001).error.message, /inside a fade/);
});

test('split, trim and join keep the envelope gain at every kept frame', () => {
  const { doc, clipId, makeId } = docWithClip();
  let d = addEnvelopePoint(doc, clipId, 0, 0, makeId).doc;
  d = addEnvelopePoint(d, clipId, 48000, 1, makeId).doc;
  const env = d.clips[clipId].envelope;
  const split = splitClip(d, clipId, 960, makeId); // frame 24000
  const left = split.doc.clips[split.leftId].envelope;
  const right = split.doc.clips[split.rightId].envelope;
  for (const p of [0, 12000, 23999]) assert.equal(envelopeGainAt(left, p), envelopeGainAt(env, p));
  for (const p of [0, 6000, 30000]) assert.equal(envelopeGainAt(right, p), envelopeGainAt(env, p + 24000));
  const trimmed = trimStart(d, clipId, 30000).doc.clips[clipId].envelope;
  assert.equal(envelopeGainAt(trimmed, 0), envelopeGainAt(env, 30000));
  const ended = trimEnd(d, clipId, -60000).doc.clips[clipId].envelope;
  assert.equal(envelopeGainAt(ended, 20000), envelopeGainAt(env, 20000));
});

test('join gives a side without an envelope unity gain', () => {
  const { doc, clipId, makeId } = docWithClip();
  const split = splitClip(doc, clipId, 960, makeId);
  const d = addEnvelopePoint(split.doc, split.rightId, 1000, 0.25, makeId).doc;
  const joined = joinClips(d, split.leftId, split.rightId, makeId).doc.clips[split.leftId].envelope;
  assert.equal(envelopeGainAt(joined, 100), 1);
  assert.equal(envelopeGainAt(joined, 23999), 1);
  assert.equal(envelopeGainAt(joined, 25000), 0.25);
});

test('trimming the start of a clip at bar 1 never moves its audio', () => {
  const { doc, clipId } = docWithClip();
  const inner = trimStart(doc, clipId, 1000).doc;
  const moved = moveClip(inner, clipId, -40).doc; // back to tick 0, sourceOffset 1000
  const back = trimStart(moved, clipId, -1000).doc.clips[clipId];
  assert.equal(back.start, 0);
  assert.equal(back.sourceOffset, 1000);
});

test('crossfades only where a later clip outlasts an earlier one, checked against every sounding clip', () => {
  const { doc, clipId, trackId, makeId } = docWithClip(); // A: frames 0–96000
  const inner = addAudioClip(doc, { trackId, tick: 960, source: { ...SOURCE, sourceId: 'src_b', frames: 12000 } }, makeId); // B inside A
  const outer = addAudioClip(inner.doc, { trackId, tick: 3000, source: SOURCE }, makeId); // C from 75000
  const c = compileModel(outer.doc, FS).model.tracks[1].clips;
  const ix = (id) => c.id.indexOf(id);
  assert.equal(c.fadeIn[ix(inner.clipId)], 0);
  assert.equal(c.fadeOut[ix(inner.clipId)], 0);
  assert.equal(c.fadeOut[ix(clipId)], 96000 - 75000);
  assert.equal(c.fadeIn[ix(outer.clipId)], 96000 - 75000);
});

test('at another context rate, split parts stay contiguous and read the same source frames', () => {
  const { doc, clipId, makeId } = docWithClip();
  const slow = setTempo(doc, 97);
  for (let tick = 101; tick < 3600; tick += 97) {
    const split = splitClip(slow, clipId, tick, makeId);
    if (!split.ok) continue;
    const c = compileModel(split.doc, 44100).model.tracks[1].clips;
    const [l, r] = [c.id.indexOf(split.leftId), c.id.indexOf(split.rightId)];
    assert.equal(c.start[l] + c.length[l], c.start[r], `tick ${tick}`);
    assert.equal(c.srcStart[r] - c.start[r], c.srcStart[l] - c.start[l], `tick ${tick}`);
    assert.equal(c.fadeIn[r], 0);
  }
});
