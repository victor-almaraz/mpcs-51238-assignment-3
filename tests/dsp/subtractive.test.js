import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../../src/dsp/engine/engine.js';
import { emptyModel } from '../../src/dsp/engine/model.js';
import { ENV_FLOOR, EnvelopeBank, RELEASE, STEAL, SUSTAIN } from '../../src/dsp/instruments/envelope.js';
import { SubtractiveKernel, WAVEFORMS } from '../../src/dsp/instruments/subtractive.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { validateModel } from '../../src/dsp/protocol.js';
import { compileModel } from '../../src/lib/audio/compile-model.js';
import { EXAMPLES } from '../../src/lib/project/examples.js';
import { cents, peak, toneMagnitude, zeroCrossingFrequency } from '../support/signal.js';

const FS = 48000;
const wave = (name) => WAVEFORMS.indexOf(name);

function kernel(params = {}, fs = FS, global = new GlobalVoices()) {
  const k = new SubtractiveKernel(fs, global);
  for (const [id, v] of Object.entries(params)) k.setParam(id, v);
  return k;
}

function render(k, frames, block = 128) {
  const out = new Float32Array(frames);
  for (let off = 0; off < frames; off += block) k.render(out, off, Math.min(off + block, frames));
  return out;
}

test('pitch: A4 sine plays 440 Hz within 1 cent; MIDI 60 and 81 too', () => {
  for (const [pitch, freq] of [[69, 440], [60, 261.6255653], [81, 880]]) {
    const k = kernel({ waveform: wave('sine'), cutoff: 16000, attack: 0.002 });
    k.noteOn(1, pitch, 100);
    const out = render(k, FS);
    const f = zeroCrossingFrequency(out, FS, 4800, FS - 4800);
    assert.ok(Math.abs(cents(f, freq)) < 1, `pitch ${pitch}: ${f} Hz`);
  }
});

test('saw, square and triangle carry the fundamental at the note frequency', () => {
  for (const name of ['saw', 'square', 'triangle']) {
    const k = kernel({ waveform: wave(name), cutoff: 16000 });
    k.noteOn(1, 57, 127); // 220 Hz
    const out = render(k, FS);
    const at = toneMagnitude(out, 220, FS, 4800, 16384);
    const off = toneMagnitude(out, 233, FS, 4800, 16384);
    assert.ok(at > 20 * off, `${name}: fundamental ${at} vs ${off}`);
  }
});

test('PolyBLEP: a 5 kHz saw keeps aliases at least 30 dB below the fundamental', () => {
  const k = kernel({ waveform: wave('saw'), cutoff: 16000, resonance: 0 });
  k.noteOn(1, 0, 127);
  k.dt[k.pool.find(1)] = 5000 / FS; // exactly 5 kHz
  const out = render(k, FS);
  const n = 32768;
  const fundamental = toneMagnitude(out, 5000, FS, 4800, n);
  let worstAlias = 0;
  // Aliases of harmonics k·5 kHz above Nyquist fold to |k·5000 − m·48000|; none fall on a harmonic.
  for (let h = 5; h <= 40; h++) {
    let f = (h * 5000) % FS;
    if (f > FS / 2) f = FS - f;
    if (f % 5000 === 0 || f < 100) continue;
    worstAlias = Math.max(worstAlias, toneMagnitude(out, f, FS, 4800, n));
  }
  const db = 20 * Math.log10(worstAlias / fundamental);
  assert.ok(db < -30, `worst alias ${db.toFixed(1)} dB`);
});

test('voice cap: 16 held voices per instrument; extra notes steal', () => {
  const k = kernel();
  for (let i = 0; i < 20; i++) k.noteOn(i, 48 + i, 100);
  assert.equal(k.pool.held, 16);
  render(k, 128);
  assert.equal(k.activeVoices(), 16, 'stolen voices finish their 64-frame fade');
  assert.equal(k.pool.find(0), -1, 'the oldest held note was stolen');
  assert.ok(k.pool.find(19) >= 0);
});

test('stealing prefers the quietest released voice over held voices', () => {
  const k = kernel({ release: 4 });
  for (let i = 0; i < 16; i++) k.noteOn(i, 48 + i, 100);
  const slot5 = k.pool.find(5);
  const slot9 = k.pool.find(9);
  render(k, 4800);
  k.noteOff(5);
  render(k, 9600);
  k.noteOff(9);
  render(k, 128);
  k.noteOn(100, 80, 100);
  assert.equal(k.env.stage[slot5], STEAL, 'the quieter released voice is stolen');
  assert.equal(k.env.stage[slot9], RELEASE, 'the louder released voice keeps releasing');
  assert.ok(k.pool.find(0) >= 0, 'held notes are kept');
  assert.equal(k.pool.held, 16);
});

test('global cap: 64 voices across instruments; a full budget drops notes of an instrument with none', () => {
  const global = new GlobalVoices();
  const kernels = Array.from({ length: 5 }, () => kernel({}, FS, global));
  for (let k = 0; k < 4; k++) for (let i = 0; i < 16; i++) kernels[k].noteOn(i, 40 + i, 100);
  assert.equal(global.count, 64);
  kernels[4].noteOn(1, 60, 100);
  assert.equal(kernels[4].pool.held, 0);
  assert.equal(global.count, 64);
  kernels[0].noteOn(99, 70, 100);
  assert.equal(global.count, 64, 'an instrument at the global cap steals its own voice');
  for (const k of kernels) k.allNotesOff(true);
  for (const k of kernels) render(k, 256);
  assert.equal(global.count, 0);
});

test('Nyquist: cutoff is clamped to 0.45·fs and full resonance stays bounded', () => {
  for (const fs of [22050, 44100, 48000]) {
    const k = kernel({ waveform: wave('square'), cutoff: 16000, resonance: 20 }, fs);
    for (let p = 30; p < 100; p += 7) k.noteOn(p, p, 127);
    const out = render(k, fs);
    for (const x of out) assert.ok(Number.isFinite(x));
    assert.ok(peak(out) < 20, `fs ${fs}: peak ${peak(out)}`);
    assert.ok(k.coef[0] > 0 && k.coef[0] < 1);
  }
});

test('envelope: linear attack to 1, release to −80 dB over the release time, then free', () => {
  const env = new EnvelopeBank(FS, 1);
  env.start(0, 0.01);
  let l = 0;
  for (let i = 0; i < 480; i++) l = env.next(0);
  assert.equal(l, 1);
  assert.equal(env.stage[0], SUSTAIN);
  env.release(0, 0.5);
  assert.equal(env.stage[0], RELEASE);
  for (let i = 0; i < 0.5 * FS - 1; i++) l = env.next(0);
  assert.ok(Math.abs(20 * Math.log10(l) + 80) < 0.1, `level after release ${20 * Math.log10(l)} dB`);
  for (let i = 0; i < FS && env.active(0); i++) env.next(0);
  assert.equal(env.active(0), false);
  assert.ok(ENV_FLOOR === 1e-4);
});

test('velocity scales the level by 0.3·(vel/127)²', () => {
  const peakFor = (vel) => {
    const k = kernel({ waveform: wave('sine'), cutoff: 16000 });
    k.noteOn(1, 69, vel);
    return peak(render(k, 9600), 4800);
  };
  assert.ok(Math.abs(peakFor(127) - 0.3) < 0.01);
  assert.ok(Math.abs(peakFor(64) / peakFor(127) - (64 / 127) ** 2) < 0.01);
});

test('polyphony auto-gain is min(1, 2/√voices)', () => {
  const k = kernel();
  for (let i = 0; i < 16; i++) k.noteOn(i, 40 + i, 100);
  render(k, FS / 2);
  assert.ok(Math.abs(k.polyGain.y - 0.5) < 1e-3);
  const two = kernel();
  two.noteOn(1, 60, 100);
  two.noteOn(2, 64, 100);
  render(two, FS / 2);
  assert.equal(two.polyGain.y, 1);
});

test('two renders are bit-identical', () => {
  const run = () => {
    const k = kernel({ waveform: wave('triangle'), resonance: 12 });
    k.noteOn(1, 45, 110);
    k.noteOn(2, 52, 90);
    const out = render(k, FS / 2, 100);
    k.noteOff(1);
    return [out, render(k, FS / 2, 77)];
  };
  assert.deepEqual(run(), run());
});

/** Engine with one subtractive track whose notes are [startFrame, endFrame, pitch]. */
function engineWithNotes(notes) {
  const e = new Engine(FS);
  const payload = {
    ...emptyModel(FS),
    tracks: [
      {
        trackId: 'trk_a', gainDb: 0, pan: 0, mute: false, solo: false,
        deviceId: 'dev_a',
        type: 'subtractive',
        params: { waveform: wave('sine'), cutoff: 16000, attack: 0.002, release: 0.01 },
        notes: {
          start: Int32Array.from(notes, (n) => n[0]),
          end: Int32Array.from(notes, (n) => n[1]),
          pitch: Uint8Array.from(notes, (n) => n[2]),
          vel: Uint8Array.from(notes, () => 127),
        },
      },
    ],
  };
  assert.equal(validateModel(payload), null);
  e.setModel(e.prepareModel(payload));
  return e;
}

function renderEngine(e, frames, quantum = 128) {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let off = 0; off < frames; off += quantum) {
    const end = Math.min(off + quantum, frames);
    e.process(l.subarray(off, end), r.subarray(off, end), 0, end - off);
  }
  return l;
}

test('engine: sequenced notes start and end at their frames', () => {
  const e = engineWithNotes([[1000, 25000, 69]]);
  e.play(0);
  const out = renderEngine(e, FS);
  assert.equal(peak(out, 0, 1000), 0, 'silent before the note');
  assert.ok(peak(out, 2000, 24000) > 0.01);
  assert.ok(peak(out, 25000 + 0.02 * FS, FS) < 1e-4, 'released after its end frame');
  const f = zeroCrossingFrequency(out, FS, 5000, 15000);
  assert.ok(Math.abs(cents(f, 440)) < 1);
});

test('engine: a note-off and note-on at the same frame retrigger the pitch', () => {
  const e = engineWithNotes([[0, 12000, 60], [12000, 24000, 60]]);
  e.play(0);
  renderEngine(e, 12000 + 64);
  const kernelRef = e.model.tracks[0].kernel;
  assert.ok(kernelRef.pool.find(1) >= 0, 'the second note sounds');
  assert.equal(kernelRef.pool.find(0), -1, 'the first note was released first');
});

test('engine: stop releases notes; play from a later frame skips earlier notes', () => {
  const e = engineWithNotes([[0, 40000, 60], [30000, 40000, 64]]);
  e.play(0);
  renderEngine(e, 4800);
  e.stop();
  const tail = renderEngine(e, 4800);
  assert.ok(peak(tail, 2400) < 1e-4);
  e.play(29000);
  renderEngine(e, 2000);
  const k = e.model.tracks[0].kernel;
  assert.equal(k.pool.find(0), -1, 'a note already under way is not chased');
  assert.ok(k.pool.find(1) >= 0);
});

test('engine: kernels persist across model swaps by device ID and release their voices when removed', () => {
  const e = engineWithNotes([[0, 40000, 60]]);
  e.play(0);
  renderEngine(e, 1280);
  const before = e.model.tracks[0].kernel;
  const same = engineWithNotes([[0, 40000, 60]]);
  e.setModel(e.prepareModel({ ...emptyModel(FS), tracks: [same.model.tracks.length ? {
    trackId: 'trk_a', gainDb: 0, pan: 0, mute: false, solo: false, deviceId: 'dev_a', type: 'subtractive', params: {},
    notes: { start: new Int32Array(0), end: new Int32Array(0), pitch: new Uint8Array(0), vel: new Uint8Array(0) },
  } : null] }));
  assert.equal(e.model.tracks[0].kernel, before);
  e.setModel(e.prepareModel(emptyModel(FS)));
  assert.equal(e.globalVoices.count, 0);
});

test('compileModel: the Beat bass becomes a sorted subtractive track', () => {
  const beat = EXAMPLES.find((x) => x.slug === 'beat').doc;
  const { model } = compileModel(beat, FS);
  assert.equal(validateModel(model), null);
  const bass = model.tracks.find((t) => t.type === 'subtractive');
  assert.ok(bass.notes.start.length > 0);
  for (let i = 1; i < bass.notes.start.length; i++) assert.ok(bass.notes.start[i] >= bass.notes.start[i - 1]);
  assert.equal(bass.params.cutoff, 2000, 'defaults fill unset params');
  const drums = model.tracks.find((t) => t.type === 'drums');
  assert.ok(drums, 'instrument types without a kernel still compile');
});
