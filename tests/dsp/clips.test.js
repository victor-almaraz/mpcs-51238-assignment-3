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
  MAX_LOOP_PASSES,
  addAudioClip,
  addAudioTrack,
  addEnvelopePoint,
  audioPasses,
  clipEndTick,
  envelopeGainAt,
  deleteClip,
  duplicateClip,
  joinBlocker,
  joinClips,
  isLooping,
  loopEnd,
  moveClip,
  removeTrack,
  renameClip,
  setClipColor,
  setClipGain,
  setClipLooping,
  setFade,
  splitClip,
  trimEnd,
  trimStart,
} from '../../src/lib/project/clip-commands.js';
import { createProject, setTempo, setTrack } from '../../src/lib/project/model.js';
import { addNote, createClip, expandClipNotes } from '../../src/lib/project/midi-commands.js';
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

test('removeTrack drops the track with its clips, devices and unused sources; the master stays', () => {
  const { doc, clipId, trackId } = docWithClip();
  const instrumentId = doc.trackOrder[0];
  const gone = removeTrack(doc, trackId);
  assert.ok(gone.ok);
  assert.deepEqual(gone.doc.trackOrder, [instrumentId]);
  assert.equal(gone.doc.tracks[trackId], undefined);
  assert.equal(gone.doc.clips[clipId], undefined);
  assert.deepEqual(gone.doc.sources, {});
  const deviceId = doc.tracks[instrumentId].deviceIds[0];
  const empty = removeTrack(gone.doc, instrumentId).doc;
  assert.deepEqual(empty.trackOrder, []);
  assert.equal(empty.devices[deviceId], undefined);
  assert.ok(empty.tracks[doc.masterTrackId]);
  assert.equal(removeTrack(empty, doc.masterTrackId).ok, false);
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
  assert.equal(setClipColor(doc, clipId, '#6a4fa9').doc.clips[clipId].color, '#6a4fa9');
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

test('setInstrumentType swaps the instrument in place and keeps clips, effects and mixer settings', async () => {
  const { setInstrumentType, addInstrumentTrack } = await import('../../src/lib/project/clip-commands.js');
  const { addEffect } = await import('../../src/lib/project/effect-commands.js');
  const { createClip } = await import('../../src/lib/project/midi-commands.js');
  let doc = createProject({ id: 'prj_swap', name: 'Swap', tempo: 120, timeSignature: '4/4', now: '2026-01-01T00:00:00.000Z' });
  const added = addInstrumentTrack(doc, 'subtractive');
  doc = added.doc;
  const trackId = added.trackId;
  doc = createClip(doc, trackId).doc;
  doc = addEffect(doc, trackId, 'delay').doc;
  doc = setTrack(doc, trackId, { gainDb: -6, mute: true });
  const before = doc.tracks[trackId];
  const oldDevice = before.deviceIds[0];

  const result = setInstrumentType(doc, trackId, 'fm');
  assert.equal(result.ok, true);
  const after = result.doc.tracks[trackId];
  assert.notEqual(after.deviceIds[0], oldDevice);
  assert.equal(result.doc.devices[after.deviceIds[0]].type, 'fm');
  assert.equal(result.doc.devices[oldDevice], undefined);
  assert.deepEqual(after.deviceIds.slice(1), before.deviceIds.slice(1), 'effects stay');
  assert.deepEqual(after.clipIds, before.clipIds, 'clips stay');
  assert.deepEqual([after.gainDb, after.mute, after.name, after.color], [before.gainDb, before.mute, before.name, before.color]);
  // The same type changes nothing; a non-instrument track or unknown type is refused.
  assert.equal(setInstrumentType(result.doc, trackId, 'fm').doc, result.doc);
  assert.equal(setInstrumentType(result.doc, result.doc.masterTrackId, 'fm').ok, false);
  assert.equal(setInstrumentType(result.doc, trackId, 'theremin').ok, false);
});

/** A one-bar MIDI clip on the project's instrument track with notes at beats 1 and 3. */
function riff() {
  const makeId = ids();
  let doc = createProject({ name: 'Loop', tempo: 120, timeSignature: '4/4', now: 0, makeId });
  const made = createClip(doc, doc.trackOrder[0], { start: 3840, length: 3840 }, makeId);
  doc = made.doc;
  for (const tick of [0, 1920]) doc = addNote(doc, made.clipId, { tick, pitch: 60, length: 480 }, makeId).doc;
  return { doc, clipId: made.clipId, makeId };
}
const played = (clip) => expandClipNotes(clip).map((n) => n.tick);

test('loopEnd lengthens a MIDI clip as a loop of its current length', () => {
  const { doc, clipId } = riff();
  const looped = loopEnd(doc, clipId, 2 * 3840 + 1920).doc.clips[clipId];
  assert.equal(looped.loopLength, 3840);
  assert.equal(looped.length, 3 * 3840 + 1920);
  assert.deepEqual(played(looped), [0, 1920, 3840, 5760, 7680, 9600, 11520]);
  assert.equal(looped.notes.length, 2, 'repeats are not stored as notes');
  // A plain trim end of a clip that is not looping adds empty time.
  assert.deepEqual(played(trimEnd(doc, clipId, 3840).doc.clips[clipId]), [0, 1920]);
});

test('stopping a loop, splitting or trimming its start keeps every note it played', () => {
  const { doc, clipId, makeId } = riff();
  const looping = loopEnd(doc, clipId, 3840).doc;
  const stopped = setClipLooping(looping, clipId, false, makeId).doc.clips[clipId];
  assert.equal(stopped.loopLength, undefined);
  assert.deepEqual(played(stopped), [0, 1920, 3840, 5760]);
  assert.equal(new Set(stopped.notes.map((n) => n.id)).size, 4);

  const split = splitClip(looping, clipId, 3840 + 4800, makeId);
  assert.ok(split.ok);
  assert.deepEqual(played(split.doc.clips[split.leftId]), [0, 1920, 3840]);
  assert.deepEqual(played(split.doc.clips[split.rightId]), [960]);

  const trimmed = trimStart(looping, clipId, 1920).doc.clips[clipId];
  assert.deepEqual(played(trimmed), [0, 1920, 3840]);
  assert.equal(trimmed.loopLength, undefined);
});

/**
 * An audio clip shaped for loop tests: a window of 94999 frames (not a whole
 * number of ticks, so passes end in a gap of silence), fades, a gain and an
 * envelope segment that crosses the window end.
 */
function shapedWindow() {
  const { doc, clipId, trackId, makeId } = docWithClip();
  let shaped = trimEnd(doc, clipId, -1001).doc;
  shaped = setFade(shaped, clipId, 'fadeIn', 2000, 'exp').doc;
  shaped = setFade(shaped, clipId, 'fadeOut', 3000, 'equalPower').doc;
  shaped = setClipGain(shaped, clipId, -2).doc;
  shaped = addEnvelopePoint(shaped, clipId, 20000, 0.4, makeId).doc;
  shaped = addEnvelopePoint(shaped, clipId, 90000, 1.3, makeId).doc;
  return { doc: shaped, clipId, trackId, makeId };
}

/** Loop length of shapedWindow's clip: its end tick, tickAt(94998) + 1, so each pass is 95000 frames apart. */
const WINDOW_TICKS = 3800;
const PASS = WINDOW_TICKS * FRAMES_PER_TICK;

/** The compiled clip arrays of the audio track, without the clip IDs. */
function compiledClips(doc, fs = FS) {
  const { id: _ids, ...arrays } = compileModel(doc, fs).model.tracks[1].clips;
  return arrays;
}

test('loopEnd repeats an audio clip window every loopLength ticks and crops the last pass', () => {
  const { doc, clipId } = docWithClip();
  assert.equal(clipEndTick(doc, doc.clips[clipId]), 3840);
  const looped = loopEnd(doc, clipId, 3840 + 1920).doc;
  const clip = looped.clips[clipId];
  assert.ok(isLooping(clip));
  assert.deepEqual([clip.loopLength, clip.length, clip.sourceLength], [3840, 3 * 3840 - 1920, 96000]);
  assert.equal(clipEndTick(looped, clip), 3 * 3840 - 1920);
  const passes = audioPasses(looped, clip);
  assert.deepEqual(passes.map((p) => [p.start, p.sourceOffset, p.sourceLength]), [[0, 0, 96000], [3840, 0, 96000], [7680, 0, 48000]]);
  assert.equal(passes[0].id, clipId);
  assert.equal(passes[1].loopLength, undefined);
  const c = compileModel(looped, FS).model.tracks[1].clips;
  assert.deepEqual([...c.start], [0, 96000, 192000]);
  assert.deepEqual([...c.srcStart], [0, 0, 0]);
  assert.equal(validateModel(compileModel(looped, FS).model), null);
  // Turning looping on alone changes neither the clip end nor the sound.
  const on = setClipLooping(doc, clipId, true).doc;
  assert.deepEqual(compiledClips(on), compiledClips(doc));
  // A looping clip's end trims by ticks; the shortest loop plays 64 frames and the longest MAX_LOOP_PASSES passes.
  assert.equal(trimEnd(looped, clipId, -960).doc.clips[clipId].length, clip.length - 960);
  assert.equal(trimEnd(looped, clipId, -1e9).doc.clips[clipId].length, 3);
  const longest = trimEnd(looped, clipId, 1e9).doc;
  assert.equal(longest.clips[clipId].length, 3840 * MAX_LOOP_PASSES);
  assert.equal(validateModel(compileModel(longest, FS).model), null);
});

test('an audio loop renders the same as its passes written out as clips, fades, envelope and crossfades included', () => {
  const { doc, clipId, trackId, makeId } = shapedWindow();
  let looped = loopEnd(doc, clipId, WINDOW_TICKS + 1000).doc;
  assert.equal(looped.clips[clipId].loopLength, WINDOW_TICKS);
  // A later clip that starts inside the last pass and outlasts it crossfades with it.
  looped = addAudioClip(looped, { trackId, tick: clipEndTick(looped, looped.clips[clipId]) - 500, source: SOURCE }, makeId).doc;
  const stopped = setClipLooping(looped, clipId, false, makeId);
  assert.ok(stopped.ok);
  const track = stopped.doc.tracks[trackId];
  assert.equal(track.clipIds.length, 4, 'three passes and the later clip');
  assert.equal(track.clipIds[0], clipId);
  assert.ok(track.clipIds.every((id) => !isLooping(stopped.doc.clips[id])));
  assert.deepEqual(compiledClips(stopped.doc), compiledClips(looped));
  assert.deepEqual(compiledClips(stopped.doc, 44100), compiledClips(looped, 44100));
  const frames = 3 * 96000 + 96000;
  const channels = [tone(96000)];
  const [al, ar] = render(looped, channels, frames);
  const [bl, br] = render(stopped.doc, channels, frames);
  assert.ok(peak(al.subarray(2 * PASS, 2 * PASS + 25000)) > 0.05, 'the third pass sounds');
  assert.deepEqual(bl, al);
  assert.deepEqual(br, ar);
  // Each pass starts again from the window start: pass 2 sounds like pass 1.
  const p1 = al.subarray(0, 94999);
  const p2 = al.subarray(PASS, PASS + 94999);
  assert.deepEqual(p2, p1);
  assert.equal(al[94999], 0, 'the window ends a frame before the next pass, in silence');
});

test('split, start trims and join of an audio loop keep what it plays', () => {
  const { doc, clipId, trackId, makeId } = shapedWindow();
  const looped = loopEnd(doc, clipId, 2 * WINDOW_TICKS).doc;
  const channels = [tone(96000)];
  const frames = 3 * 96000;
  const [al] = render(looped, channels, frames);

  // A split inside the second pass: the passes become clips and that pass splits.
  const split = splitClip(looped, clipId, WINDOW_TICKS + 1001, makeId);
  assert.ok(split.ok);
  assert.equal(split.doc.tracks[trackId].clipIds.length, 4);
  assert.equal(split.doc.clips[split.rightId].start, WINDOW_TICKS + 1001);
  assert.deepEqual(render(split.doc, channels, frames)[0], al);
  // At a pass boundary, the passes on either side are the parts.
  const atBoundary = splitClip(looped, clipId, WINDOW_TICKS, makeId);
  assert.ok(atBoundary.ok);
  assert.equal(atBoundary.doc.clips[atBoundary.rightId].start, WINDOW_TICKS);
  assert.equal(atBoundary.leftId, clipId);
  // Inside a pass's fade, the split is refused and the loop stays.
  assert.equal(splitClip(looped, clipId, WINDOW_TICKS + 10, makeId).ok, false);

  // A start trim trims the first pass; the other passes stay where they were.
  const trimmed = trimStart(looped, clipId, 4800, makeId).doc;
  const ids = trimmed.tracks[trackId].clipIds;
  assert.equal(ids.length, 3);
  assert.equal(trimmed.clips[clipId].sourceOffset, 4800);
  assert.equal(isLooping(trimmed.clips[clipId]), false);
  assert.deepEqual(render(trimmed, channels, frames)[0].subarray(PASS), al.subarray(PASS));

  // A loop of the first half of a tick-aligned clip joins with the second half placed at its end.
  const plain = docWithClip();
  const halves = splitClip(plain.doc, plain.clipId, 1920, plain.makeId);
  let joinable = loopEnd(halves.doc, halves.leftId, 1920).doc;
  joinable = moveClip(joinable, halves.rightId, 1920).doc;
  assert.equal(joinBlocker(joinable, halves.leftId, halves.rightId), null);
  const [before] = render(joinable, channels, frames);
  const joined = joinClips(joinable, halves.leftId, halves.rightId, plain.makeId);
  assert.ok(joined.ok);
  const kept = joined.doc.clips[joined.clipId];
  assert.deepEqual([kept.start, kept.sourceOffset, kept.sourceLength], [1920, 0, 96000]);
  assert.equal(joined.doc.tracks[plain.trackId].clipIds.length, 2);
  assert.deepEqual(render(joined.doc, channels, frames)[0], before);
});
