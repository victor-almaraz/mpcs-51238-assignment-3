import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK, FADE_TABLE_SIZE, SMOOTH_TAU_S } from '../../src/dsp/core/constants.js';
import { clamp, dbToGain, flushDenormal, gainToDb } from '../../src/dsp/core/math.js';
import { clampParam, clampParams, defineParam, fromNorm, paramDefaults, toNorm } from '../../src/dsp/core/params.js';
import { Mulberry32, hash32, mulberry32 } from '../../src/dsp/core/prng.js';
import { Deque, Ring } from '../../src/dsp/core/ring.js';
import { Smoother, smoothingCoeff } from '../../src/dsp/core/smoother.js';
import { FADE_TABLES, NOTE_FREQUENCIES, VELOCITY_GAIN, buildFadeTable, readTable } from '../../src/dsp/core/tables.js';

const cutoff = defineParam({ id: 'cutoff', min: 40, max: 16000, default: 2000, unit: 'Hz', scale: 'log' });
const ratio = defineParam({ id: 'ratio', min: 0.5, max: 12, default: 2, scale: 'lin', step: 0.5 });
const wave = defineParam({ id: 'waveform', scale: 'enum', options: ['sine', 'square', 'saw', 'triangle'], default: 2 });
const attack = defineParam({ id: 'attack', min: 0.002, max: 2, default: 0.01, unit: 's', scale: 'pow3' });

test('constants: BLOCK is 128 frames and smoothing τ is 12 ms', () => {
  assert.equal(BLOCK, 128);
  assert.equal(SMOOTH_TAU_S, 0.012);
});

test('clampParam clamps to [min, max]', () => {
  assert.equal(clampParam(cutoff, 10), 40);
  assert.equal(clampParam(cutoff, 1e9), 16000);
  assert.equal(clampParam(cutoff, 440), 440);
  assert.equal(clampParam(cutoff, -Infinity), 2000, 'non-finite values give the default');
});

test('clampParam gives the default for non-numbers', () => {
  for (const bad of [NaN, Infinity, undefined, null, '440', {}]) assert.equal(clampParam(cutoff, bad), 2000, String(bad));
});

test('clampParam snaps stepped params from min', () => {
  assert.equal(clampParam(ratio, 2.2), 2);
  assert.equal(clampParam(ratio, 2.3), 2.5);
  assert.equal(clampParam(ratio, 11.99), 12);
  assert.equal(clampParam(ratio, 0.1), 0.5);
});

test('enum params hold an option index', () => {
  assert.deepEqual([wave.min, wave.max, wave.step], [0, 3, 1]);
  assert.equal(clampParam(wave, 1.4), 1);
  assert.equal(clampParam(wave, 7), 3);
  assert.equal(wave.options[clampParam(wave, 2)], 'saw');
});

test('defineParam rejects inconsistent definitions', () => {
  assert.throws(() => defineParam({ id: 'x', min: 1, max: 0, default: 0, scale: 'lin' }));
  assert.throws(() => defineParam({ id: 'x', min: 0, max: 1, default: 2, scale: 'lin' }));
  assert.throws(() => defineParam({ id: 'x', min: 0, max: 1, default: 0.5, scale: 'log' }));
  assert.throws(() => defineParam({ id: 'x', min: 0, max: 1, default: 0.5, scale: 'cubic' }));
  assert.throws(() => defineParam({ id: 'x', scale: 'enum', options: ['one'], default: 0 }));
  assert.throws(() => defineParam({ min: 0, max: 1, default: 0, scale: 'lin' }));
  assert.ok(Object.isFrozen(cutoff));
});

test('toNorm and fromNorm invert each other on every scale', () => {
  for (const def of [cutoff, attack]) {
    for (const u of [0, 0.25, 0.5, 0.9, 1]) assert.ok(Math.abs(toNorm(def, fromNorm(def, u)) - u) < 1e-9, `${def.id} ${u}`);
  }
  assert.ok(Math.abs(fromNorm(cutoff, 0.5) - Math.sqrt(40 * 16000)) < 1e-6, 'log midpoint is the geometric mean');
  assert.equal(fromNorm(attack, 0), 0.002);
  assert.equal(fromNorm(attack, 2), 2, 'positions are clamped to [0, 1]');
});

test('paramDefaults and clampParams build complete parameter objects', () => {
  const defs = [cutoff, ratio];
  assert.deepEqual(paramDefaults(defs), { cutoff: 2000, ratio: 2 });
  assert.deepEqual(clampParams(defs, { cutoff: 99999, extra: 1 }), { cutoff: 16000, ratio: 2 });
  assert.deepEqual(clampParams(defs, undefined), { cutoff: 2000, ratio: 2 });
});

test('smoother: one-pole with a = 1 − exp(−1/(τ·fs)); 63.2 % of a step after τ', () => {
  const fs = 48000;
  assert.equal(smoothingCoeff(fs), 1 - Math.exp(-1 / (0.012 * fs)));
  const s = new Smoother(fs, 0);
  s.setTarget(1);
  const n = Math.round(0.012 * fs);
  for (let i = 0; i < n; i++) s.next();
  assert.ok(Math.abs(s.y - (1 - Math.exp(-1))) < 1e-3, `after τ: ${s.y}`);
  for (let i = 0; i < fs; i++) s.next();
  s.flush();
  assert.equal(s.y, 1, 'flush snaps a settled smoother to its target');
  assert.ok(s.settled());
});

test('mulberry32: fixed sequence for seed 1', () => {
  const expected = [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849];
  const fn = mulberry32(1);
  assert.deepEqual(expected.map(() => fn()), expected);
  const obj = new Mulberry32(1);
  assert.deepEqual(expected.map(() => obj.next()), expected, 'the class gives the same sequence');
  obj.reseed(1);
  assert.equal(obj.next(), expected[0]);
});

test('mulberry32 stays in [0, 1) and bipolar noise in [−1, 1)', () => {
  const r = new Mulberry32(12345);
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  for (let i = 0; i < 100000; i++) {
    const x = r.next();
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
    sum += x;
    const b = r.nextBipolar();
    assert.ok(b >= -1 && b < 1);
  }
  assert.ok(lo >= 0 && hi < 1);
  assert.ok(Math.abs(sum / 100000 - 0.5) < 0.01, 'mean near 0.5');
});

test('hash32 is deterministic, unsigned and order-sensitive', () => {
  assert.equal(hash32(1, 2, 3), hash32(1, 2, 3));
  assert.notEqual(hash32(1, 2, 3), hash32(3, 2, 1));
  assert.notEqual(hash32(0, 0, 0), hash32(0, 0, 1));
  const seen = new Set();
  for (let e = 0; e < 1000; e++) seen.add(hash32(7, 3, e));
  assert.equal(seen.size, 1000);
  assert.ok(hash32(-1, -2, -3) >= 0 && hash32(-1, -2, -3) <= 0xffffffff);
});

test('note frequencies follow 440·2^((n − 69)/12)', () => {
  assert.equal(NOTE_FREQUENCIES[69], 440);
  assert.ok(Math.abs(NOTE_FREQUENCIES[60] - 261.6255653) < 1e-6);
  assert.ok(Math.abs(NOTE_FREQUENCIES[81] - 880) < 1e-9);
  assert.equal(NOTE_FREQUENCIES.length, 128);
});

test('velocity gain is 0.3·(vel/127)²', () => {
  assert.equal(VELOCITY_GAIN[0], 0);
  assert.ok(Math.abs(VELOCITY_GAIN[127] - 0.3) < 1e-7);
  assert.ok(Math.abs(VELOCITY_GAIN[64] - 0.3 * (64 / 127) ** 2) < 1e-7);
});

test('fade tables: 1025 entries, endpoints, equal-power sums to unity', () => {
  const [linear, equalPower, exp] = FADE_TABLES;
  for (const t of FADE_TABLES) {
    assert.equal(t.length, FADE_TABLE_SIZE);
    assert.equal(t[0], 0);
    assert.ok(Math.abs(t[t.length - 1] - 1) < 1e-6);
  }
  assert.ok(Math.abs(readTable(linear, 0.3) - 0.3) < 1e-6);
  assert.ok(Math.abs(readTable(exp, 0.5) - 10 ** -1.5) < 1e-3);
  for (const x of [0.1, 0.37, 0.5, 0.81]) {
    const a = readTable(equalPower, x);
    const b = readTable(equalPower, 1 - x);
    assert.ok(Math.abs(a * a + b * b - 1) < 1e-4, `a² + b² at ${x}`);
  }
  assert.equal(readTable(linear, -1), 0);
  assert.equal(readTable(linear, 2), 1);
  assert.throws(() => buildFadeTable('cosine'));
});

test('math helpers', () => {
  assert.equal(dbToGain(0), 1);
  assert.equal(dbToGain(-Infinity), 0);
  assert.ok(Math.abs(dbToGain(-12) - 0.251189) < 1e-6);
  assert.ok(Math.abs(gainToDb(0.5) + 6.0206) < 1e-4);
  assert.equal(gainToDb(0), -Infinity);
  assert.equal(flushDenormal(1e-20), 0);
  assert.equal(flushDenormal(-1e-20), 0);
  assert.equal(flushDenormal(1e-10), 1e-10);
  assert.equal(clamp(5, 0, 1), 1);
});

test('Ring keeps the newest values and a running sum', () => {
  const r = new Ring(3);
  assert.equal(r.push(1), 0);
  r.push(2);
  r.push(3);
  assert.equal(r.sum, 6);
  assert.equal(r.push(4), 1, 'evicts the oldest');
  assert.equal(r.sum, 9);
  assert.deepEqual([r.get(0), r.get(1), r.get(2)], [4, 3, 2]);
  r.sum += 1e-9;
  r.resum();
  assert.equal(r.sum, 9);
  r.clear();
  assert.deepEqual([r.size, r.sum], [0, 0]);
  assert.throws(() => new Ring(0));
});

test('Deque supports a sliding-window minimum', () => {
  const values = [5, 3, 4, 1, 6, 2, 7];
  const window = 3;
  const dq = new Deque(window + 1, Int32Array);
  const mins = [];
  values.forEach((v, n) => {
    while (dq.size > 0 && values[dq.back()] >= v) dq.popBack();
    dq.pushBack(n);
    if (dq.front() <= n - window) dq.popFront();
    mins.push(values[dq.front()]);
  });
  assert.deepEqual(mins, [5, 3, 3, 1, 1, 1, 2]);
  const small = new Deque(1);
  small.pushBack(1);
  assert.throws(() => small.pushBack(2));
});
