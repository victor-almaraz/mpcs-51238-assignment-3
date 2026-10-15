import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../../src/dsp/engine/engine.js';
import { buildEngineModel, emptyModel } from '../../src/dsp/engine/model.js';
import { reportQuanta, validateEngineMessage, validateModel } from '../../src/dsp/protocol.js';
import { compileModel } from '../../src/lib/audio/compile-model.js';
import { createProject } from '../../src/lib/project/model.js';

const FS = 48000;
const CLICK_PEAK = 0.2512 * 0.2512; // −12 dB click × −12 dB master

function render(engine, frames, quantum = 128) {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let off = 0; off < frames; off += quantum) {
    const end = Math.min(off + quantum, frames);
    const ql = l.subarray(off, end);
    const qr = r.subarray(off, end);
    engine.process(ql, qr, 0, end - off);
  }
  return [l, r];
}

/** Frames where a click starts: first non-zero sample after at least 1000 frames of near-silence. */
function clickStarts(buf) {
  const starts = [];
  let quiet = 1000;
  for (let i = 0; i < buf.length; i++) {
    if (Math.abs(buf[i]) > 1e-6) {
      if (quiet >= 1000) starts.push(i);
      quiet = 0;
    } else quiet++;
  }
  return starts;
}

function peak(buf, start = 0, end = buf.length) {
  let p = 0;
  for (let i = start; i < end; i++) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

/** Zero crossings per second over [start, start + n). */
function frequency(buf, start, n) {
  let crossings = 0;
  for (let i = start + 1; i < start + n; i++) if ((buf[i - 1] <= 0) !== (buf[i] <= 0)) crossings++;
  return (crossings / 2) * (FS / n);
}

test('a stopped engine without a metronome renders exact silence', () => {
  const e = new Engine(FS);
  const [l, r] = render(e, FS);
  assert.equal(peak(l), 0);
  assert.equal(peak(r), 0);
});

test('play advances the playhead by the frames rendered; stop holds it', () => {
  const e = new Engine(FS);
  e.play(1000);
  render(e, 4800);
  assert.equal(e.playFrame, 5800);
  e.stop();
  render(e, 4800);
  assert.equal(e.playFrame, 5800);
  e.locate(96000);
  assert.equal(e.playFrame, 96000);
});

test('metronome: clicks on every beat at 120 BPM, accented on the downbeat', () => {
  const e = new Engine(FS);
  e.setMetronome(true);
  e.play(0);
  const [l, r] = render(e, 4 * FS);
  const starts = clickStarts(l);
  assert.deepEqual(starts, [0, 24000, 48000, 72000, 96000, 120000, 144000, 168000].map((f) => f + 1));
  assert.equal(l.findIndex((x, i) => x !== r[i]), -1, 'both channels carry the click');
  assert.ok(Math.abs(frequency(l, 0, 480) - 1500) < 60, 'downbeat 1500 Hz');
  assert.ok(Math.abs(frequency(l, 24000, 480) - 1000) < 60, 'other beats 1000 Hz');
  assert.ok(Math.abs(frequency(l, 96000, 480) - 1500) < 60, 'bar 2 downbeat');
  assert.ok(peak(l) <= CLICK_PEAK + 1e-6 && peak(l) > CLICK_PEAK * 0.95, `peak ${peak(l)}`);
  assert.ok(peak(l, 24000 - 100, 24000) < 1e-5, 'a click decays before the next beat');
});

test('metronome off: silence while playing', () => {
  const e = new Engine(FS);
  e.play(0);
  const [l] = render(e, FS);
  assert.equal(peak(l), 0);
});

test('loop wrap is sample-accurate inside a quantum', () => {
  const e = new Engine(FS);
  e.setMetronome(true);
  e.setLoop(true, 0, 48000);
  e.play(40000);
  const [l] = render(e, 16000, 128);
  assert.equal(e.playFrame, 8000);
  assert.deepEqual(clickStarts(l), [8001], 'the loop start (a downbeat) clicks exactly at the wrap');
});

test('a loop end on a block boundary still wraps', () => {
  const e = new Engine(FS);
  e.setLoop(true, 0, 48000);
  e.play(48000 - 1280);
  render(e, 1280 + 640, 128);
  assert.equal(e.playFrame, 640);
});

test('quantum length does not change the output', () => {
  const run = (quantum) => {
    const e = new Engine(FS);
    e.setMetronome(true);
    e.setLoop(true, 0, 60000);
    e.play(10000);
    return render(e, 3 * FS, quantum);
  };
  const reference = run(128);
  // Compare with a cheap check first: deepEqual on 144 000-sample arrays builds an enormous diff on failure.
  for (const q of [100, 256, 441, 1024]) {
    const [l, r] = run(q);
    const firstDiff = l.findIndex((x, i) => x !== reference[0][i] || r[i] !== reference[1][i]);
    assert.equal(firstDiff, -1, `quantum ${q} differs at frame ${firstDiff}`);
  }
});

test('tempo and meter from the model place the beats', () => {
  const e = new Engine(FS);
  e.setModel(
    buildEngineModel({
      ...emptyModel(FS),
      tempo: [{ tick: 0, bpm: 90, shape: 'step' }],
      meter: [{ tick: 0, numerator: 6, denominator: 8 }],
    }),
  );
  e.setMetronome(true);
  e.play(0);
  const [l] = render(e, 3 * FS);
  const eighth = (60 / 90 / 2) * FS; // 16000 frames
  assert.deepEqual(clickStarts(l).slice(0, 7), [0, 1, 2, 3, 4, 5, 6].map((k) => k * eighth + 1));
  assert.ok(Math.abs(frequency(l, 6 * eighth, 480) - 1500) < 60, 'bar 2 of 6/8 is accented');
});

test('master volume is clamped to 0 dB and smoothed', () => {
  const e = new Engine(FS);
  e.setMasterVolume(12);
  assert.equal(e.master.target, 1);
  e.setMasterVolume(-Infinity);
  assert.ok(Math.abs(e.master.target - 10 ** (-12 / 20)) < 1e-12, 'non-finite falls back to the −12 dB default');
});

test('protocol: engine messages validate', () => {
  assert.equal(validateEngineMessage({ t: 'init', v: 1, seed: 1 }), null);
  assert.equal(validateEngineMessage({ t: 'transport', v: 1, op: 'play', frame: 0 }), null);
  assert.equal(validateEngineMessage({ t: 'transport', v: 1, op: 'play' }), 'bad-frame');
  assert.equal(validateEngineMessage({ t: 'transport', v: 1, op: 'loop', loopOn: true, loopStart: 10, loopEnd: 5 }), 'bad-loop');
  assert.equal(validateEngineMessage({ t: 'metronome', v: 1, on: true, gainDb: 0 }), null);
  assert.equal(validateEngineMessage({ t: 'model', v: 1, rev: 1, model: emptyModel(FS) }), null);
  assert.equal(validateEngineMessage({ t: 'model', v: 1, rev: 1, model: { ...emptyModel(FS), schema: 2 } }), 'bad-schema');
  assert.equal(validateEngineMessage({ t: 'warp', v: 1 }), 'unknown-type');
  assert.equal(reportQuanta(48000, 128), 9);
  assert.equal(reportQuanta(8000, 1024), 1);
});

test('compileModel converts a project to frames at the context rate', () => {
  const doc = createProject({ name: 'x', tempo: 120, timeSignature: '3/4', now: '2026-01-01T00:00:00.000Z' });
  const { model, tempo } = compileModel(doc, 44100);
  assert.equal(validateModel(model), null);
  assert.equal(model.fs, 44100);
  assert.equal(tempo.frameAt(960), 22050);
  assert.equal(model.endFrame, 4 * 3 * 22050, 'an empty project spans four bars');
  assert.deepEqual([model.loopStartFrame, model.loopEndFrame], [0, model.endFrame]);
  const looped = compileModel({ ...doc, loop: { start: 960, end: 1920 } }, 48000).model;
  assert.deepEqual([looped.loopStartFrame, looped.loopEndFrame], [24000, 48000]);
});
