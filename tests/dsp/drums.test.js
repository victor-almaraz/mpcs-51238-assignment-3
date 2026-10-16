import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLOSED_HAT, COWBELL, CRASH, DRUM_MAP, KICK, OPEN_HAT, PEDAL_HAT, RIDE, drumRowLabel, voiceOfNote,
} from '../../src/dsp/instruments/drum-map.js';
import { DRUM_PARAMS, DrumKernel } from '../../src/dsp/instruments/drums.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { Engine } from '../../src/dsp/engine/engine.js';
import { settleSmoothers } from '../../src/dsp/core/smoother.js';
import { emptyModel } from '../../src/dsp/engine/model.js';
import { peak, toneMagnitude, zeroCrossingFrequency } from '../support/signal.js';

const FS = 48000;

function kernel(params = {}, global = new GlobalVoices()) {
  const k = new DrumKernel(FS, global);
  for (const [id, v] of Object.entries(params)) k.setParam(id, v);
  settleSmoothers(k);
  return k;
}

function render(k, frames, block = 128) {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let off = 0; off < frames; off += block) k.render(l, r, off, Math.min(off + block, frames));
  return [l, r];
}

test('73 parameters: three kit controls and five per voice', () => {
  assert.equal(DRUM_PARAMS.length, 73);
  assert.deepEqual(DRUM_PARAMS.slice(0, 3).map((d) => d.id), ['kit.level', 'kit.velSens', 'kit.choke']);
  assert.ok(DRUM_PARAMS.some((d) => d.id === 'claves.pan'));
});

test('GM map: 21 mapped notes over 14 voices; row labels name note, voice and GM name', () => {
  assert.equal(DRUM_MAP.length, 21);
  assert.equal(new Set(DRUM_MAP.map((e) => e.voice)).size, 14);
  assert.equal(drumRowLabel(36), '36 Kick (Bass Drum 1)');
  assert.equal(drumRowLabel(42), '42 Closed hat (Closed Hi-Hat)');
  assert.equal(drumRowLabel(60), '60 No voice');
  assert.equal(voiceOfNote[60], -1);
});

test('unmapped note 60 outputs exact zeros and allocates no instance', () => {
  const k = kernel();
  k.noteOn(1, 60, 127);
  assert.equal(k.pool.held, 0);
  const [l, r] = render(k, 4800);
  assert.equal(peak(l), 0);
  assert.equal(peak(r), 0);
});

test('kick fundamental is 50 Hz ± 0.5 Hz', () => {
  const k = kernel({ 'kick.decay': 4 });
  k.noteOn(1, 36, 127);
  const [l] = render(k, FS);
  const f = zeroCrossingFrequency(l, FS, 0.1 * FS, 0.5 * FS);
  assert.ok(Math.abs(f - 50) <= 0.5, `${f} Hz`);
});

test('the kick pitch envelope starts above 50 Hz: the first period is shorter than 20 ms', () => {
  const k = kernel();
  k.noteOn(1, 36, 127);
  const [l] = render(k, 4800);
  let first = -1;
  for (let i = 1; i < l.length && first < 0; i++) if (l[i - 1] < 0 && l[i] >= 0) first = i;
  // From phase 0 the first rising zero crossing ends the first period.
  assert.ok(first > 0 && first < 0.8 * (FS / 50), `first period ${first} frames`);
});

test('cowbell peaks at 540 and 800 Hz ± 2 Hz', () => {
  const k = kernel({ 'cowbell.decay': 4 });
  k.noteOn(1, 56, 127);
  const [l] = render(k, FS);
  const n = 16384;
  const peakNear = (centre) => {
    let best = centre;
    let bestMag = 0;
    for (let f = centre - 15; f <= centre + 15; f += 0.25) {
      const m = toneMagnitude(l, f, FS, 0, n);
      if (m > bestMag) {
        bestMag = m;
        best = f;
      }
    }
    return best;
  };
  for (const target of [540, 800]) {
    const found = peakNear(target);
    assert.ok(Math.abs(found - target) <= 2, `peak near ${target}: ${found} Hz`);
  }
});

test('closed hat silences an open hat within 64 frames when choke is on', () => {
  const k = kernel();
  k.noteOn(1, 46, 127);
  render(k, 4800);
  assert.equal(k.instancesOf(OPEN_HAT), 1);
  k.noteOn(2, 42, 127);
  render(k, 64);
  let openSounding = 0;
  for (let s = 0; s < k.slots; s++) if (k.vid[s] === OPEN_HAT && k.env.stage[s] !== 0) openSounding++;
  assert.equal(openSounding, 0);
  assert.equal(k.instancesOf(CLOSED_HAT), 1);
  // Pedal hat chokes too; with choke off, the open hat rings on.
  k.noteOn(3, 46, 127);
  k.noteOn(4, 44, 127);
  render(k, 64);
  assert.equal(k.instancesOf(OPEN_HAT), 0);
  assert.equal(k.instancesOf(PEDAL_HAT), 1);
  const free = kernel({ 'kit.choke': 0 });
  free.noteOn(1, 46, 127);
  free.noteOn(2, 42, 127);
  render(free, 64);
  assert.equal(free.instancesOf(OPEN_HAT), 1);
});

test('voices are monophonic; crash and ride keep two instances', () => {
  const k = kernel();
  for (let i = 0; i < 3; i++) k.noteOn(i, 36, 127);
  render(k, 64);
  assert.equal(k.instancesOf(KICK), 1, 'a retrigger fades the previous kick');
  for (let i = 10; i < 13; i++) k.noteOn(i, 49, 127);
  for (let i = 20; i < 23; i++) k.noteOn(i, 51, 127);
  render(k, 64);
  assert.equal(k.instancesOf(CRASH), 2);
  assert.equal(k.instancesOf(RIDE), 2);
});

test('note-off has no effect; a hit ends when its envelope falls below 1e-4', () => {
  const k = kernel();
  k.noteOn(1, 75, 127); // claves, T60 75 ms
  k.noteOff(1);
  const [l] = render(k, 2400);
  assert.ok(peak(l) > 0.01, 'still sounding after note-off');
  render(k, FS);
  assert.equal(k.activeVoices(), 0);
  assert.equal(k.pool.held, 0);
});

test('every voice renders finite, bounded audio at full settings', () => {
  for (const e of DRUM_MAP) {
    const k = kernel({ 'kit.level': 6, [`${['kick', 'snare', 'sidestick', 'clap', 'closedHat', 'pedalHat', 'openHat', 'lowTom', 'midTom', 'highTom', 'crash', 'ride', 'cowbell', 'claves'][e.voice]}.level`]: 6 });
    k.noteOn(1, e.note, 127);
    const [l, r] = render(k, FS / 4);
    for (let i = 0; i < l.length; i++) assert.ok(Number.isFinite(l[i]) && Number.isFinite(r[i]), `note ${e.note}`);
    assert.ok(peak(l) > 1e-3, `note ${e.note} sounds`);
    // +12 dB of kit and voice level on a voice peaking near 1 × velocity gain 0.3.
    assert.ok(peak(l) < 0.3 * Math.SQRT1_2 * 3.99 * 1.15, `note ${e.note} peak ${peak(l)}`);
  }
});

test('pan: centre gives equal channels, full left silences the right', () => {
  const centre = kernel();
  centre.noteOn(1, 38, 127);
  const [l, r] = render(centre, 4800);
  assert.deepEqual(l, r);
  const left = kernel({ 'snare.pan': -1 });
  left.noteOn(1, 38, 127);
  const [ll, rr] = render(left, FS / 2);
  assert.ok(peak(ll) > 0.01);
  assert.ok(peak(rr) < 1e-6);
});

test('velocity sensitivity: s = 0 ignores velocity; s = 1 follows 0.3·vn²', () => {
  const level = (sens, vel) => {
    const k = kernel({ 'kit.velSens': sens });
    k.noteOn(1, 75, vel);
    return k.gain[k.pool.find(1)];
  };
  assert.equal(level(0, 1), 0.3);
  assert.ok(Math.abs(level(1, 64) - 0.3 * (64 / 127) ** 2) < 1e-12);
});

test('two renders of a pattern are bit-identical; different event indices give different noise', () => {
  const pattern = (offset = 0) => {
    const k = kernel();
    k.seed = 7;
    const out = [];
    [36, 42, 38, 46, 39, 49].forEach((note, i) => {
      k.noteOn(i + offset, note, 110);
      out.push(...render(k, 2400, 100)[0]);
    });
    return Float32Array.from(out);
  };
  assert.deepEqual(pattern(), pattern());
  const snareAt = (eventIndex) => {
    const k = kernel({ 'snare.tone': 1 });
    k.noteOn(eventIndex, 38, 127);
    return render(k, 2400)[0];
  };
  assert.notDeepEqual(snareAt(1), snareAt(2));
});

test('the instance cap holds at 16 with stealing; the global cap is shared', () => {
  const global = new GlobalVoices();
  const k = kernel({}, global);
  const notes = DRUM_MAP.map((e) => e.note);
  notes.forEach((note, i) => k.noteOn(i, note, 127));
  assert.ok(k.pool.held <= 16);
  assert.equal(global.count, k.pool.held);
  k.allNotesOff(true);
  render(k, 128);
  assert.equal(k.activeVoices(), 0);
  assert.equal(global.count, 0);
});

test('engine: a drum track renders in stereo', () => {
  const e = new Engine(FS);
  e.setModel(
    e.prepareModel({
      ...emptyModel(FS),
      tracks: [
        {
          deviceId: 'dev_drums',
          type: 'drums',
          params: { 'kick.pan': -1 },
          notes: { start: Int32Array.of(0), end: Int32Array.of(100), pitch: Uint8Array.of(36), vel: Uint8Array.of(127) },
        },
      ],
    }),
  );
  e.play(0);
  const l = new Float32Array(4800);
  const r = new Float32Array(4800);
  for (let off = 0; off < 4800; off += 128) e.process(l.subarray(off, off + 128), r.subarray(off, off + 128), 0, 128);
  assert.ok(peak(l) > 0.01);
  assert.ok(peak(r) < 1e-6, 'the kick is panned hard left');
});
