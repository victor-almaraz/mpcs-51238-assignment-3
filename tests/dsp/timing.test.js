import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mulberry32 } from '../../src/dsp/core/prng.js';
import { MeterMap } from '../../src/dsp/timing/meter-map.js';
import { TempoMap } from '../../src/dsp/timing/tempo-map.js';

const MAPS = {
  'constant 120': [{ tick: 0, bpm: 120, shape: 'step' }],
  'steps 90 → 174 → 60': [
    { tick: 0, bpm: 90, shape: 'step' },
    { tick: 7680, bpm: 174, shape: 'step' },
    { tick: 30000, bpm: 60, shape: 'step' },
  ],
  'linear ramps': [
    { tick: 0, bpm: 80, shape: 'linear' },
    { tick: 15360, bpm: 160, shape: 'step' },
    { tick: 23040, bpm: 160, shape: 'linear' },
    { tick: 46080, bpm: 40, shape: 'linear' },
  ],
  'extremes 20 and 999': [
    { tick: 0, bpm: 999, shape: 'step' },
    { tick: 9600, bpm: 20, shape: 'linear' },
    { tick: 19200, bpm: 999, shape: 'step' },
  ],
};

for (const [name, points] of Object.entries(MAPS)) {
  for (const fs of [44100, 48000, 96000]) {
    test(`tickAt(frameAt(t)) === t for 10 000 random ticks: ${name} at ${fs} Hz`, () => {
      const map = new TempoMap(points, fs);
      const rng = new Mulberry32(fs);
      for (let i = 0; i < 10000; i++) {
        const t = Math.floor(rng.next() * 200000);
        const f = map.frameAt(t);
        assert.equal(map.tickAt(f), t, `tick ${t} → frame ${f}`);
      }
    });
  }
}

test('frameAt is strictly increasing over ticks', () => {
  const map = new TempoMap(MAPS['linear ramps'], 48000);
  let prev = -1;
  for (let t = 0; t < 60000; t++) {
    const f = map.frameAt(t);
    assert.ok(f > prev, `tick ${t}`);
    prev = f;
  }
});

test('constant tempo: one beat at 120 BPM is 0.5 s', () => {
  const map = new TempoMap(MAPS['constant 120'], 48000);
  assert.equal(map.frameAt(0), 0);
  assert.equal(map.frameAt(960), 24000);
  assert.equal(map.secondsAt(3840), 2);
  assert.equal(map.tickAt(23999), 959);
  assert.equal(map.tickAt(24000), 960);
});

test('step segments accumulate seconds', () => {
  const map = new TempoMap(MAPS['steps 90 → 174 → 60'], 48000);
  const s1 = (60 * 7680) / (960 * 90);
  assert.ok(Math.abs(map.secondsAt(7680) - s1) < 1e-12);
  assert.ok(Math.abs(map.secondsAt(8640) - (s1 + 60 / 174)) < 1e-12);
  assert.equal(map.bpmAt(8000), 174);
});

test('a linear ramp matches numerical integration of 60/(PPQ·b(x))', () => {
  const map = new TempoMap(MAPS['linear ramps'], 48000);
  let s = 0;
  const steps = 15360 * 16;
  for (let k = 0; k < steps; k++) {
    const x = ((k + 0.5) / steps) * 15360;
    const b = 80 + (80 * x) / 15360;
    s += (60 / (960 * b)) * (15360 / steps);
  }
  assert.ok(Math.abs(map.secondsAt(15360) - s) < 1e-9, `${map.secondsAt(15360)} vs ${s}`);
  assert.equal(map.bpmAt(7680), 120);
  assert.ok(Math.abs(map.tickAtSeconds(map.secondsAt(5000)) - 5000) < 1e-6, 'closed-form inverse');
});

test('a linear last point is constant', () => {
  const map = new TempoMap([{ tick: 0, bpm: 100, shape: 'linear' }], 48000);
  assert.equal(map.bpmAt(1e6), 100);
  assert.equal(map.secondsAt(960), 0.6);
});

test('tempo map validation', () => {
  assert.throws(() => new TempoMap([], 48000));
  assert.throws(() => new TempoMap([{ tick: 10, bpm: 120, shape: 'step' }], 48000));
  assert.throws(() => new TempoMap([{ tick: 0, bpm: 120, shape: 'step' }, { tick: 0, bpm: 90, shape: 'step' }], 48000));
  assert.throws(() => new TempoMap([{ tick: 0, bpm: 120, shape: 'curve' }], 48000));
  assert.throws(() => new TempoMap([{ tick: 0, bpm: NaN, shape: 'step' }], 48000));
  assert.throws(() => new TempoMap([{ tick: 0, bpm: 120, shape: 'step' }], 0));
  assert.equal(new TempoMap([{ tick: 0, bpm: 5000, shape: 'step' }], 48000).bpmAt(0), 999, 'bpm is clamped');
});

test('meter map: bars and beats across a 4/4 → 3/4 → 6/8 change', () => {
  const meter = new MeterMap([
    { tick: 0, numerator: 4, denominator: 4 },
    { tick: 2 * 3840, numerator: 3, denominator: 4 },
    { tick: 2 * 3840 + 2 * 2880, numerator: 6, denominator: 8 },
  ]);
  assert.equal(meter.barAt(0), 0);
  assert.equal(meter.barAt(3839), 0);
  assert.equal(meter.barAt(3840), 1);
  assert.equal(meter.barAt(7680), 2);
  assert.equal(meter.barTicksAt(7680), 2880);
  assert.equal(meter.barAt(7680 + 2880), 3);
  assert.equal(meter.beatAt(7680 + 2880 + 1920), 2);
  assert.equal(meter.tickAtBar(4), 13440);
  assert.equal(meter.barAt(13440), 4);
  assert.equal(meter.beatTicksAt(13440), 480);
  assert.equal(meter.beatsPerBarAt(13440), 6);
  assert.equal(meter.beatAt(13440 + 480 * 5 + 10), 5);
  assert.equal(meter.tickInBeat(13440 + 480 * 5 + 10), 10);
  assert.equal(meter.tickAtBar(6), 13440 + 2 * 2880);
});

test('meter map validation', () => {
  assert.throws(() => new MeterMap([{ tick: 960, numerator: 4, denominator: 4 }]));
  assert.throws(() => new MeterMap([{ tick: 0, numerator: 4, denominator: 3 }]));
  assert.throws(() => new MeterMap([{ tick: 0, numerator: 0, denominator: 4 }]));
  assert.throws(
    () => new MeterMap([{ tick: 0, numerator: 4, denominator: 4 }, { tick: 1920, numerator: 3, denominator: 4 }]),
    /bar boundary/,
  );
});
