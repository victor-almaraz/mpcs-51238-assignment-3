import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FmKernel, maxIndex } from '../../src/dsp/instruments/fm.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { cents, peak, toneMagnitude, zeroCrossingFrequency } from '../support/signal.js';

const FS = 48000;

function kernel(params = {}, fs = FS, global = new GlobalVoices()) {
  const k = new FmKernel(fs, global);
  for (const [id, v] of Object.entries(params)) k.setParam(id, v);
  return k;
}

function render(k, frames, block = 128) {
  const out = new Float32Array(frames);
  for (let off = 0; off < frames; off += block) k.render(out, off, Math.min(off + block, frames));
  return out;
}

test('index 0 gives a pure carrier at the note pitch within 1 cent', () => {
  for (const [pitch, freq] of [[69, 440], [45, 110], [93, 1760]]) {
    const k = kernel({ index: 0, ratio: 3 });
    k.noteOn(1, pitch, 100);
    const out = render(k, FS);
    assert.ok(Math.abs(cents(zeroCrossingFrequency(out, FS, 2400, FS - 2400), freq)) < 1, `pitch ${pitch}`);
  }
});

test('modulation puts sidebands at fc ± k·fm', () => {
  const k = kernel({ ratio: 2, index: 2, indexDecay: 4 });
  k.noteOn(1, 57, 127); // fc 220 Hz, fm 440 Hz
  const out = render(k, FS);
  const n = 16384;
  const carrier = toneMagnitude(out, 220, FS, 2400, n);
  const upper = toneMagnitude(out, 660, FS, 2400, n);
  const second = toneMagnitude(out, 1100, FS, 2400, n);
  const between = toneMagnitude(out, 440, FS, 2400, n);
  assert.ok(upper > 0.1 * carrier, `fc + fm ${upper} vs carrier ${carrier}`);
  assert.ok(second > 0.05 * carrier, 'fc + 2fm');
  assert.ok(between < 0.2 * upper, 'fm itself folds onto −fc + fm, which is weak at index 2');
});

test('I_max = max(0, (0.45·fs − fc)/fm − 1) clamps the index', () => {
  assert.equal(maxIndex(440, 880, 48000), (21600 - 440) / 880 - 1);
  assert.equal(maxIndex(8372, 100464, 48000), 0);
  // A high note at ratio 12 cannot modulate: the output stays a pure carrier.
  const k = kernel({ ratio: 12, index: 20 });
  k.noteOn(1, 120, 127);
  const out = render(k, FS / 2);
  const f = zeroCrossingFrequency(out, FS, 1200, FS / 2 - 1200);
  assert.ok(Math.abs(cents(f, 8372.018)) < 2, `clamped to the carrier: ${f} Hz`);
});

test('the highest significant sideband stays at or below 0.45·fs', () => {
  for (const pitch of [60, 84, 100]) {
    const k = kernel({ ratio: 1, index: 20, indexDecay: 4 });
    k.noteOn(1, pitch, 127);
    const out = render(k, 16384 + 2400);
    const total = toneMagnitude(out, 440 * 2 ** ((pitch - 69) / 12), FS, 2400, 16384);
    let above = 0;
    for (let f = 0.46 * FS; f < 0.5 * FS; f += 200) above = Math.max(above, toneMagnitude(out, f, FS, 2400, 16384));
    assert.ok(above < 0.05 * Math.max(total, 0.01), `pitch ${pitch}: energy above 0.45·fs ${above}`);
  }
});

test('the index decays with time constant indexDecay', () => {
  const k = kernel({ ratio: 1, index: 3, indexDecay: 0.1 });
  k.noteOn(1, 57, 127);
  const out = render(k, FS);
  const early = toneMagnitude(out, 440, FS, 480, 2048); // fc + fm = 440 Hz
  const late = toneMagnitude(out, 440, FS, 0.5 * FS, 2048);
  assert.ok(late < 0.1 * early, `sideband fades: ${early} → ${late}`);
  const v = k.pool.find(1);
  assert.ok(Math.abs(k.decay[v] - Math.exp(-1 / 0.1)) < 1e-3, 'exp(−t/τ) after 1 s');
});

test('ratio steps by 0.5 and parameters clamp', () => {
  const k = kernel({ ratio: 2.2, index: 99, indexDecay: 0 });
  assert.equal(k.ratio, 2);
  assert.equal(k.index.target, 20);
  assert.equal(k.indexDecay, 0.01);
});

test('voices: 16 held per instrument; output stays finite and bounded at full settings', () => {
  const k = kernel({ ratio: 12, index: 20 });
  for (let i = 0; i < 20; i++) k.noteOn(i, 30 + 4 * i, 127);
  assert.equal(k.pool.held, 16);
  const out = render(k, FS / 2);
  for (const x of out) assert.ok(Number.isFinite(x));
  assert.ok(peak(out) <= 0.3 * 16 * 0.5 + 1e-6, 'each voice ≤ velocity gain, auto-gain 0.5 at 16 voices');
});

test('two renders are bit-identical', () => {
  const run = () => {
    const k = kernel({ ratio: 3.5, index: 7 });
    k.noteOn(1, 50, 100);
    k.noteOn(2, 62, 80);
    const a = render(k, 20000, 100);
    k.noteOff(1);
    return [a, render(k, 20000, 333)];
  };
  assert.deepEqual(run(), run());
});
