import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOTE_FREQUENCIES } from '../../src/dsp/core/tables.js';
import { PLUCK_DELAY_SIZE, PluckKernel, RHO_MAX, pluckTuning } from '../../src/dsp/instruments/pluck.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { cents, peak } from '../support/signal.js';

function kernel(params = {}, fs = 48000) {
  const k = new PluckKernel(fs, new GlobalVoices());
  for (const [id, v] of Object.entries(params)) k.setParam(id, v);
  return k;
}

function render(k, frames, block = 128) {
  const out = new Float32Array(frames);
  for (let off = 0; off < frames; off += block) k.render(out, off, Math.min(off + block, frames));
  return out;
}

/** Fundamental from the autocorrelation peak near `expectedPeriod`, refined by parabolic interpolation. */
function periodFrequency(buf, fs, start, n, expectedPeriod) {
  const r = (lag) => {
    let s = 0;
    for (let i = start; i < start + n; i++) s += buf[i] * buf[i + lag];
    return s;
  };
  let best = 0;
  let bestVal = -Infinity;
  const lo = Math.max(2, Math.floor(expectedPeriod * 0.9));
  const hi = Math.ceil(expectedPeriod * 1.1);
  for (let lag = lo; lag <= hi; lag++) {
    const v = r(lag);
    if (v > bestVal) {
      bestVal = v;
      best = lag;
    }
  }
  const a = r(best - 1);
  const b = r(best);
  const c = r(best + 1);
  const shift = (0.5 * (a - c)) / (a - 2 * b + c);
  return fs / (best + shift);
}

test('pitch error below 1 cent across the range at 44.1 and 48 kHz', () => {
  for (const fs of [44100, 48000]) {
    for (const pitch of [40, 57, 69, 81, 88]) {
      const k = kernel({ damping: 0.5, brightness: 0.3, decay: 4 }, fs);
      k.noteOn(1, pitch, 127);
      const out = render(k, fs);
      const f = NOTE_FREQUENCIES[pitch];
      const measured = periodFrequency(out, fs, Math.round(0.1 * fs), Math.round(0.3 * fs), fs / f);
      assert.ok(Math.abs(cents(measured, f)) < 1, `fs ${fs} pitch ${pitch}: ${measured.toFixed(3)} Hz (${cents(measured, f).toFixed(2)} cents)`);
    }
  }
});

test('tuning: Δ stays in [0.1, 1.1) and the allpass coefficient follows C = (1 − Δ)/(1 + Δ)', () => {
  const out = new Float64Array(3);
  for (let pitch = 24; pitch < 128; pitch++) {
    for (const S of [0, 0.25, 0.5]) {
      const [f, N, C] = pluckTuning(NOTE_FREQUENCIES[pitch], 48000, S, out);
      const delta = 48000 / f - S - N;
      assert.ok(delta >= 0.1 - 1e-9 && delta < 1.1, `pitch ${pitch}: Δ ${delta}`);
      assert.ok(Math.abs(C - (1 - delta) / (1 + delta)) < 1e-12);
      assert.ok(N >= 1 && N < PLUCK_DELAY_SIZE);
    }
  }
});

test('a note whose period exceeds the 4096-sample delay plays octaves higher', () => {
  const out = new Float64Array(3);
  const [f, N] = pluckTuning(NOTE_FREQUENCIES[12], 96000, 0.25, out);
  assert.ok(N < PLUCK_DELAY_SIZE);
  assert.ok(Math.abs(Math.log2(f / NOTE_FREQUENCIES[12]) - Math.round(Math.log2(f / NOTE_FREQUENCIES[12]))) < 1e-12);
  assert.equal(pluckTuning(NOTE_FREQUENCIES[24], 96000, 0.25, out)[0], NOTE_FREQUENCIES[24], 'MIDI 24 fits at 96 kHz');
});

test('decay: with no damping the level falls about 60 dB over T60', () => {
  const k = kernel({ damping: 0, brightness: 1, decay: 1 });
  k.noteOn(1, 57, 127);
  const out = render(k, 1.3 * 48000);
  const rms = (a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += out[i] * out[i];
    return Math.sqrt(s / (b - a));
  };
  const early = rms(2400, 7200);
  const late = rms(48000 + 2400, 48000 + 7200);
  const db = 20 * Math.log10(late / early);
  assert.ok(db < -54 && db > -66, `drop over T60: ${db.toFixed(1)} dB`);
});

test('loop gain is capped at 0.9999 and the string never grows', () => {
  const k = kernel({ damping: 0, decay: 10 });
  k.noteOn(1, 36, 127);
  assert.ok(k.rho[k.pool.find(1)] <= RHO_MAX);
  const out = render(k, 10 * 48000, 512);
  assert.ok(peak(out, 9 * 48000) <= peak(out, 0, 48000));
  for (let i = 0; i < out.length; i += 97) assert.ok(Number.isFinite(out[i]));
});

test('output has no DC and the excitation is peak-normalised', () => {
  const k = kernel({ brightness: 0 });
  k.noteOn(1, 60, 127);
  const out = render(k, 48000);
  let mean = 0;
  for (const x of out) mean += x;
  assert.ok(Math.abs(mean / out.length) < 1e-3);
  assert.ok(peak(out) <= 0.3 * 1.05 + 1e-6, 'velocity gain bounds the output');
});

test('excitation is seeded: same note ID repeats, another ID differs', () => {
  const run = (noteId, seed = 1) => {
    const k = kernel();
    k.seed = seed;
    k.noteOn(noteId, 64, 100);
    return render(k, 4800);
  };
  assert.deepEqual(run(3), run(3));
  assert.notDeepEqual(run(3), run(4));
  assert.notDeepEqual(run(3, 1), run(3, 2));
});

test('note-off mutes within the release; voice cap holds', () => {
  const k = kernel({ decay: 10 });
  for (let i = 0; i < 20; i++) k.noteOn(i, 40 + i, 127);
  assert.equal(k.pool.held, 16);
  k.allNotesOff(false);
  render(k, 0.15 * 48000);
  const tail = render(k, 4800);
  assert.ok(peak(tail) < 1e-3);
});
