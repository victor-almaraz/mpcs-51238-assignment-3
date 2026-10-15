import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK } from '../../src/dsp/core/constants.js';
import { Mulberry32 } from '../../src/dsp/core/prng.js';
import { DcBlocker } from '../../src/dsp/safety/dc-blocker.js';
import { SustainedLevelDuck } from '../../src/dsp/safety/duck.js';
import { StartFade } from '../../src/dsp/safety/fade.js';
import { LIMITER_CEILING, Limiter, OUTPUT_CEILING } from '../../src/dsp/safety/limiter.js';
import { SafetyKernel } from '../../src/dsp/safety/safety.js';
import { validateSafetyMessage } from '../../src/dsp/protocol.js';

const FS = 48000;

/** Runs `stage.process` over stereo buffers in BLOCK chunks, as the processor does. */
function run(stage, l, r) {
  for (let off = 0; off < l.length; off += BLOCK) stage.process(l, r, off, Math.min(off + BLOCK, l.length));
}

function sine(frames, freq, amp, phase = 0) {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS + phase);
  return out;
}

function peak(buf, start = 0, end = buf.length) {
  let p = 0;
  for (let i = start; i < end; i++) p = Math.max(p, Math.abs(buf[i]));
  return p;
}

test('limiter: no sample above 0.8913 over 10⁶ random frames with peaks of 10', () => {
  const lim = new Limiter(FS);
  const rng = new Mulberry32(1);
  const frames = 1e6;
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const burst = Math.floor(i / 4800) % 3 === 0 ? 10 : 0.5;
    l[i] = rng.nextBipolar() * burst;
    r[i] = rng.nextBipolar() * burst * 0.7;
  }
  run(lim, l, r);
  assert.ok(peak(l) <= LIMITER_CEILING + 1e-7, `left peak ${peak(l)}`);
  assert.ok(peak(r) <= LIMITER_CEILING + 1e-7, `right peak ${peak(r)}`);
});

test('limiter: a full-scale 1 kHz square stays under the ceiling', () => {
  const lim = new Limiter(FS);
  const frames = FS;
  const l = new Float32Array(frames).map((_, i) => (Math.floor((i * 2000) / FS) % 2 ? 1 : -1));
  const r = l.slice();
  run(lim, l, r);
  assert.ok(peak(l) <= LIMITER_CEILING + 1e-7);
});

test('limiter: transparent below the ceiling, with L − 1 frames of latency', () => {
  const lim = new Limiter(FS);
  assert.equal(lim.L, 72);
  assert.equal(lim.D, 71);
  const input = sine(9600, 440, 0.5);
  const l = input.slice();
  const r = input.slice();
  run(lim, l, r);
  for (let i = lim.D; i < input.length; i++) assert.equal(l[i], input[i - lim.D]);
  assert.equal(lim.readReduction(), 1);
});

test('limiter: gain recovers after a burst with the 50 ms release', () => {
  const lim = new Limiter(FS);
  const frames = FS;
  const l = new Float32Array(frames);
  for (let i = 0; i < frames; i++) l[i] = i < 4800 ? 4 * Math.sin((2 * Math.PI * 440 * i) / FS) : 0.2 * Math.sin((2 * Math.PI * 440 * i) / FS);
  const r = l.slice();
  run(lim, l, r);
  assert.ok(lim.readReduction() < 0.3);
  assert.ok(lim.env > 0.999, `env ${lim.env} after 0.9 s`);
});

test('guard: NaN gives 250 ms of silence, then a 50 ms fade-in', () => {
  const k = new SafetyKernel(FS);
  const frames = FS;
  const fault = 9600;
  const l = sine(frames, 220, 0.25);
  const r = sine(frames, 220, 0.25);
  l[fault] = NaN;
  run(k, l, r);
  assert.equal(k.takeGuardTrip(), true);
  assert.equal(k.takeGuardTrip(), false, 'the trip is reported once');
  const muteEnd = fault + 0.25 * FS;
  for (let i = fault; i < muteEnd + k.latencyFrames; i++) assert.equal(l[i], 0, `frame ${i}`);
  assert.ok(peak(l, muteEnd + k.latencyFrames, muteEnd + k.latencyFrames + 480) < 0.01, 'quiet at the start of the fade');
  assert.ok(peak(l, muteEnd + 0.06 * FS, frames) > 0.2, 'full level after the fade');
  for (const buf of [l, r]) for (const x of buf) assert.ok(Number.isFinite(x));
});

test('guard: ±Infinity and |x| > 1e4 also mute', () => {
  for (const bad of [Infinity, -Infinity, 2e4]) {
    const k = new SafetyKernel(FS);
    const l = sine(FS / 2, 220, 0.25);
    const r = l.slice();
    r[4800] = bad;
    run(k, l, r);
    assert.equal(k.takeGuardTrip(), true, String(bad));
    assert.equal(peak(l, 4800, 4800 + 0.25 * FS), 0);
  }
});

test('DC blocker: removes a DC offset and passes 1 kHz', () => {
  const dc = new DcBlocker(FS);
  assert.ok(Math.abs(dc.R - 0.99869) < 1e-5);
  const frames = 3 * FS;
  const l = new Float32Array(frames).fill(0.5);
  const r = sine(frames, 1000, 0.5);
  run(dc, l, r);
  let mean = 0;
  for (let i = 2 * FS; i < frames; i++) mean += l[i];
  assert.ok(Math.abs(mean / FS) <= 1e-3, `|DC| over the last second: ${mean / FS}`);
  assert.ok(Math.abs(peak(r, 2 * FS) - 0.5) < 0.005, '1 kHz passes at unity');
});

test('duck: −6 dB after 3 s above −12 dBFS RMS; holds until acknowledged', () => {
  const duck = new SustainedLevelDuck(FS);
  const frames = 4 * FS;
  const l = sine(frames, 440, 0.5); // RMS 0.354 > 0.2512
  const r = sine(frames, 440, 0.5);
  run(duck, l, r);
  assert.equal(duck.active, true);
  assert.equal(duck.changed, true);
  assert.equal(duck.gain, 0.5);
  assert.ok(peak(l, 3.5 * FS) < 0.26);
  const quiet = new Float32Array(FS);
  const quietR = new Float32Array(FS);
  run(duck, quiet, quietR);
  assert.equal(duck.active, true, 'silence does not release the duck');
  duck.acknowledge();
  const after = sine(FS / 2, 440, 0.1);
  run(duck, after, after.slice());
  assert.equal(duck.active, false);
  assert.equal(duck.gain, 1, 'gain is back after the 50 ms ramp');
});

test('duck: a level below −12 dBFS RMS never ducks', () => {
  const duck = new SustainedLevelDuck(FS);
  const l = sine(5 * FS, 440, 0.3); // RMS 0.212
  run(duck, l, l.slice());
  assert.equal(duck.active, false);
});

test('fade: onset peak ≤ 0.02 in the first 10 ms; complete within 60 ms', () => {
  const k = new SafetyKernel(FS);
  const frames = FS / 4;
  const l = new Float32Array(frames).map((_, i) => (Math.floor((i * 2000) / FS) % 2 ? 1 : -1));
  const r = l.slice();
  run(k, l, r);
  assert.ok(peak(l, 0, 0.01 * FS) <= 0.02, `onset peak ${peak(l, 0, 0.01 * FS)}`);
  assert.ok(peak(l, 0.06 * FS + k.latencyFrames, 0.08 * FS) > 0.88, 'full level by 60 ms');
  const f = new StartFade(FS);
  run(f, new Float32Array(0.05 * FS), new Float32Array(0.05 * FS));
  assert.equal(f.done, true);
  f.restart();
  assert.equal(f.done, false);
});

test('safety kernel: random NaN-laced input stays finite and under the ceiling', () => {
  const k = new SafetyKernel(FS);
  const rng = new Mulberry32(99);
  const frames = 5 * FS;
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    l[i] = rng.nextBipolar() * 10;
    r[i] = rng.next() < 1e-4 ? NaN : rng.nextBipolar() * 3;
  }
  run(k, l, r);
  for (let i = 0; i < frames; i++) {
    assert.ok(Number.isFinite(l[i]) && Number.isFinite(r[i]), `frame ${i}`);
    assert.ok(Math.abs(l[i]) <= 0.8913 && Math.abs(r[i]) <= 0.8913, `frame ${i}: ${l[i]}, ${r[i]}`);
  }
});

test('safety kernel: two runs of the same input are bit-identical', () => {
  const render = () => {
    const k = new SafetyKernel(FS);
    const rng = new Mulberry32(7);
    const l = new Float32Array(FS).map(() => rng.nextBipolar() * 2);
    const r = l.map((x) => x * 0.5);
    run(k, l, r);
    return [l, r];
  };
  assert.deepEqual(render(), render());
});

test('the output ceiling is the largest float32 at or below 0.8913', () => {
  assert.ok(OUTPUT_CEILING <= 0.8913);
  assert.equal(Math.fround(OUTPUT_CEILING), OUTPUT_CEILING);
  assert.ok(0.8913 - OUTPUT_CEILING < 1e-7);
});

test('safety messages are validated', () => {
  assert.equal(validateSafetyMessage({ t: 'resume-fade', v: 1 }), null);
  assert.equal(validateSafetyMessage({ t: 'ack-duck', v: 1 }), null);
  assert.equal(validateSafetyMessage({ t: 'ack-duck', v: 2 }), 'bad-version');
  assert.equal(validateSafetyMessage({ t: 'explode', v: 1 }), 'unknown-type');
  assert.equal(validateSafetyMessage(null), 'not-an-object');
});
