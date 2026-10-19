import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeterMap } from '../../src/dsp/timing/meter-map.js';
import { gridStepsFrom, nextGridTick, snapToGrid } from '../../src/lib/project/grid.js';

const Q = 960; // ticks per quarter note
const sevenEight = new MeterMap([{ tick: 0, numerator: 7, denominator: 8 }]); // a bar is 3360 ticks
const fourFour = new MeterMap([{ tick: 0, numerator: 4, denominator: 4 }]);

test('in 7/8 the 1/4 grid restarts at each bar line, so bar lines are grid points', () => {
  assert.equal(snapToGrid(3400, sevenEight, Q), 3360); // multiples of 960 from 0 would give 3840
  assert.equal(snapToGrid(3360 + 960 + 100, sevenEight, Q), 4320);
  // The last, half-length step of a bar ends on the next bar line.
  assert.equal(snapToGrid(6600, sevenEight, Q), 6720);
  assert.equal(snapToGrid(6200, sevenEight, Q), 6240);
  assert.equal(snapToGrid(-50, sevenEight, Q), 0);
});

test('the Bar grid (an infinite step) snaps to the nearest bar line', () => {
  assert.equal(snapToGrid(1600, sevenEight, Infinity), 0);
  assert.equal(snapToGrid(1700, sevenEight, Infinity), 3360);
  assert.equal(nextGridTick(100, sevenEight, Infinity, 1), 3360);
  assert.equal(nextGridTick(3360, sevenEight, Infinity, -1), 0);
});

test('stepping walks grid points and stops on every bar line', () => {
  const walk = [];
  let t = 0;
  for (let i = 0; i < 5; i++) walk.push((t = nextGridTick(t, sevenEight, Q, 1)));
  assert.deepEqual(walk, [960, 1920, 2880, 3360, 4320]);
  assert.equal(nextGridTick(3360, sevenEight, Q, -1), 2880);
  assert.equal(nextGridTick(4320, sevenEight, Q, -1), 3360);
  assert.equal(nextGridTick(0, sevenEight, Q, -1), 0);
  assert.equal(gridStepsFrom(0, sevenEight, Q, 4), 3360);
  assert.equal(gridStepsFrom(4320, sevenEight, Q, -2), 2880);
});

test('in 4/4 the grid matches multiples of the step', () => {
  for (const t of [0, 100, 479, 481, 3839, 3841, 9000]) assert.equal(snapToGrid(t, fourFour, Q), Math.round(t / Q) * Q);
  assert.equal(nextGridTick(3840, fourFour, Q, 1), 4800);
});
