import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRAIN_VOICES, GranularKernel, MAX_GRAINS, SOURCES, buildSources } from '../../src/dsp/instruments/granular.js';
import { GlobalVoices } from '../../src/dsp/instruments/voice-pool.js';
import { peak, toneMagnitude } from '../support/signal.js';

const FS = 48000;

function kernel(params = {}, maxGrains) {
  const k = new GranularKernel(FS, new GlobalVoices(), maxGrains);
  for (const [id, v] of Object.entries(params)) k.setParam(id, v);
  return k;
}

function render(k, frames, block = 128, onBlock) {
  const out = new Float32Array(frames);
  for (let off = 0; off < frames; off += block) {
    k.render(out, off, Math.min(off + block, frames));
    onBlock?.(k);
  }
  return out;
}

test('sources: 2 s mono saw, noise and chord buffers; noise is the same in every instance', () => {
  const [sawBuf, noise, chord] = buildSources(FS);
  for (const b of [sawBuf, noise, chord]) assert.equal(b.length, 2 * FS);
  assert.deepEqual(buildSources(FS)[1], noise);
  assert.ok(toneMagnitude(sawBuf, 261.63, FS, 0, 32768) > 0.2);
  assert.ok(peak(chord) <= 1.05);
  assert.deepEqual(SOURCES, ['saw', 'noise', 'chord']);
});

test('at most 4 voices and 64 grains at maximum density and size', () => {
  const k = kernel({ density: 60, grainSize: 0.25 });
  for (let i = 0; i < 6; i++) k.noteOn(i, 48 + i, 127);
  assert.equal(k.pool.held, GRAIN_VOICES);
  let most = 0;
  render(k, FS, 128, (kk) => (most = Math.max(most, kk.activeGrains())));
  assert.ok(most <= MAX_GRAINS, `${most} grains`);
  assert.ok(most >= 50, 'the pool actually fills toward its limit');
});

test('with no free grain the start is skipped and counted', () => {
  const k = kernel({ density: 60, grainSize: 0.25 }, 4);
  k.noteOn(1, 60, 127);
  render(k, FS);
  assert.ok(k.activeGrains() <= 4);
  assert.ok(k.skipped > 0);
});

test('density sets the grain rate', () => {
  const k = kernel({ density: 10, grainSize: 0.02 });
  k.noteOn(1, 60, 127);
  let starts = 0;
  let last = 0;
  render(k, FS, 1, (kk) => {
    const now = kk.activeGrains();
    if (now > last) starts++;
    last = now;
  });
  assert.ok(Math.abs(starts - 10) <= 1, `${starts} grains in 1 s`);
});

test('pitch: increment f/261.63 plays the saw source at the note pitch', () => {
  for (const [pitch, freq] of [[60, 261.63], [72, 523.25]]) {
    // Non-overlapping grains: overlapping grains at increment ≠ 1 start at different
    // source phases and partly cancel at the fundamental (normal granular behaviour).
    const k = kernel({ source: 0, spray: 0, density: 4, grainSize: 0.2 });
    k.noteOn(1, pitch, 127);
    const out = render(k, FS);
    const at = toneMagnitude(out, freq, FS, 4800, 32768);
    const off = toneMagnitude(out, freq * 1.06, FS, 4800, 32768);
    assert.ok(at > 5 * off, `pitch ${pitch}: ${at} vs ${off}`);
  }
});

test('amplitude: velocity gain × min(1, 1/√(density·size)) keeps the output bounded', () => {
  for (const [density, grainSize] of [[60, 0.25], [2, 0.01], [20, 0.06]]) {
    const k = kernel({ source: 2, density, grainSize, spray: 1 });
    for (let i = 0; i < 4; i++) k.noteOn(i, 50 + 5 * i, 127);
    const out = render(k, FS);
    for (const x of out) assert.ok(Number.isFinite(x));
    assert.ok(peak(out) < 1, `density ${density}, size ${grainSize}: peak ${peak(out)}`);
  }
});

test('grains of a released voice end with it', () => {
  const k = kernel({ density: 60, grainSize: 0.25 });
  k.noteOn(1, 60, 127);
  render(k, 4800);
  k.noteOff(1);
  render(k, FS);
  assert.equal(k.activeGrains(), 0);
  assert.equal(k.activeVoices(), 0);
});

test('spray and positions are seeded: renders repeat bit for bit', () => {
  const run = (seed) => {
    const k = kernel({ source: 1, spray: 1 });
    k.seed = seed;
    k.noteOn(1, 60, 100);
    k.noteOn(2, 67, 100);
    return render(k, FS / 2, 100);
  };
  assert.deepEqual(run(5), run(5));
  assert.notDeepEqual(run(5), run(6));
});
