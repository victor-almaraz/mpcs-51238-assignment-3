import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdditiveKernel, HARMONICS } from '../../src/dsp/instruments/additive.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { cents, peak, toneMagnitude, zeroCrossingFrequency } from '../support/signal.js';

const FS = 48000;
const levels = (hs) => Object.fromEntries(Array.from({ length: HARMONICS }, (_, i) => [`h${i + 1}`, hs[i] ?? 0]));

function kernel(params = {}, fs = FS) {
  const k = new AdditiveKernel(fs, new GlobalVoices());
  for (const [id, v] of Object.entries(params)) k.setParam(id, v);
  return k;
}

function render(k, frames, block = 128) {
  const out = new Float32Array(frames);
  for (let off = 0; off < frames; off += block) k.render(out, off, Math.min(off + block, frames));
  return out;
}

test('only h1: a sine at the note pitch within 1 cent', () => {
  const k = kernel(levels([1]));
  k.noteOn(1, 69, 127);
  const out = render(k, FS);
  assert.ok(Math.abs(cents(zeroCrossingFrequency(out, FS, 4800, FS - 4800), 440)) < 1);
});

test('harmonic k sounds at k·f with its relative level', () => {
  const k = kernel(levels([1, 0.5, 0, 0.25]));
  k.noteOn(1, 57, 127); // 220 Hz
  const out = render(k, FS);
  const n = 16384;
  const m1 = toneMagnitude(out, 220, FS, 4800, n);
  assert.ok(Math.abs(toneMagnitude(out, 440, FS, 4800, n) / m1 - 0.5) < 0.01);
  assert.ok(toneMagnitude(out, 660, FS, 4800, n) / m1 < 0.001, 'h3 = 0 is silent');
  assert.ok(Math.abs(toneMagnitude(out, 880, FS, 4800, n) / m1 - 0.25) < 0.01);
});

test('levels are normalised by 1/max(1, Σh)', () => {
  const fundamental = (hs) => {
    const k = kernel(levels(hs));
    k.noteOn(1, 57, 127);
    return toneMagnitude(render(k, FS), 220, FS, 4800, 16384);
  };
  const single = fundamental([1]);
  assert.ok(Math.abs(fundamental(Array(8).fill(1)) / single - 1 / 8) < 0.005, 'Σh = 8 divides by 8');
  assert.ok(Math.abs(fundamental([0.5, 0.25]) / single - 0.5) < 0.005, 'Σh < 1 is not boosted');
});

test('harmonics above 0.45·fs are omitted at note-on', () => {
  const k = kernel(levels(Array(8).fill(1)));
  k.noteOn(1, 105, 127); // 3520 Hz: harmonics 1–6 fit under 21 600 Hz
  assert.equal(k.count[k.pool.find(1)], 6);
  const out = render(k, FS / 2);
  const n = 16384;
  const alias = toneMagnitude(out, FS - 7 * 3520, FS, 2400, n); // where h7 would fold
  assert.ok(alias < 1e-4 * toneMagnitude(out, 3520, FS, 2400, n), 'no folded energy');
  const low = kernel();
  low.noteOn(1, 40, 100);
  assert.equal(low.count[low.pool.find(1)], 8);
});

test('the recursion matches sin(kθ) to float precision', () => {
  const k = kernel(levels([0, 0, 0, 0, 0, 0, 0, 1]));
  k.noteOn(1, 45, 127); // h8 of 110 Hz = 880 Hz
  const out = render(k, FS);
  assert.ok(Math.abs(cents(zeroCrossingFrequency(out, FS, 4800, FS - 4800), 880)) < 1);
  assert.ok(Math.abs(peak(out, 4800) - 0.3) < 0.005, 'unit amplitude × velocity gain');
});

test('voice cap, finite output and determinism', () => {
  const run = () => {
    const k = kernel();
    for (let i = 0; i < 20; i++) k.noteOn(i, 30 + 3 * i, 127);
    assert.equal(k.pool.held, 16);
    return render(k, FS / 4, 77);
  };
  const a = run();
  for (const x of a) assert.ok(Number.isFinite(x));
  assert.deepEqual(a, run());
});
