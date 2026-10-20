import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatParam, parseParam } from '../../src/components/instruments/param-text.js';
import { INSTRUMENTS } from '../../src/dsp/instruments/registry.js';
import { EFFECTS } from '../../src/dsp/effects/registry.js';

const def = (unit, min, max, extra = {}) => ({ id: 'x', unit, min, max, ...extra });
const cutoff = def('Hz', 20, 16000);
const attack = def('s', 0.001, 4);
const decay = def('s', 0.2, 10);
const sampleMs = def('ms', 0, 2000);
const vibrato = def('Hz', 0.5, 12);
const drumDecay = def('×', 0.1, 4);
const envSt = def('× 48 st', -1, 1);

test('readouts keep the precision a value needs: Hz and × below the switch points, 48-semitone steps', () => {
  assert.equal(formatParam(vibrato, 0.5), '0.5 Hz');
  assert.equal(formatParam(vibrato, 1.49), '1.5 Hz');
  assert.equal(formatParam(cutoff, 440), '440 Hz');
  assert.equal(formatParam(cutoff, 2000), '2.0 kHz');
  assert.equal(formatParam(drumDecay, 0.15), '0.15×');
  assert.equal(formatParam(drumDecay, 2.5), '2.5×');
  assert.equal(formatParam(envSt, 0.01), '+0.5 st');
  assert.equal(formatParam(envSt, -0.01), '−0.5 st');
  assert.equal(formatParam(envSt, 0), '0.0 st');
});

test('the unit follows the rounded value, so a readout never shows 1000 ms or 10.0 ms', () => {
  assert.equal(formatParam(decay, 0.9996), '1.00 s');
  assert.equal(formatParam(attack, 0.0024), '2.4 ms');
  assert.equal(formatParam(attack, 0.25), '250 ms');
  assert.equal(formatParam(sampleMs, 9.99), '10 ms');
  assert.equal(formatParam(sampleMs, 9.6), '9.6 ms');
  assert.equal(formatParam(cutoff, 999.7), '1.0 kHz');
});

test('a bare number takes the shown unit, or the finest unit when that is out of range', () => {
  assert.equal(parseParam(cutoff, '5', '2.0 kHz'), 5000);
  assert.equal(parseParam(cutoff, '800', '2.0 kHz'), 800);
  assert.equal(parseParam(decay, '500', '2.00 s'), 0.5);
  assert.equal(parseParam(decay, '3', '2.00 s'), 3);
  assert.equal(parseParam(attack, '20', '10 ms'), 0.02);
  assert.equal(parseParam(def('fraction', 0, 1), '50', '20 %'), 0.5);
});

test('typed units must belong to the parameter', () => {
  assert.equal(parseParam(cutoff, '2k'), 2000);
  assert.equal(parseParam(cutoff, '2 kHz'), 2000);
  assert.equal(parseParam(cutoff, '500 ms'), null);
  assert.equal(parseParam(attack, '2 kHz'), null);
  assert.equal(parseParam(attack, '1.5 s'), 1.5);
  assert.equal(parseParam(def('offset', -1, 1), '5 %'), null);
  assert.equal(parseParam(def('dB', -60, 6), '6 st'), null);
  assert.equal(parseParam(def('Q', 0.1, 18), 'Q 0.71'), 0.71);
  assert.equal(parseParam(def('pan', -1, 1), 'L-20'), null);
  assert.equal(parseParam(def('pan', -1, 1), 'L20'), -0.2);
  assert.equal(parseParam(cutoff, 'loud'), null);
});

test('every instrument and effect readout reads back to itself', () => {
  const defs = [...Object.values(INSTRUMENTS), ...Object.values(EFFECTS)].flatMap((e) => e.params).filter((d) => d.scale !== 'enum' && d.unit !== 'note');
  for (const d of defs) {
    for (let i = 0; i <= 50; i++) {
      const v = d.min + ((d.max - d.min) * i) / 50;
      const text = formatParam(d, v);
      const back = parseParam(d, text, text);
      assert.notEqual(back, null, `${d.id} (${d.unit}) cannot read back "${text}"`);
      assert.equal(formatParam(d, back), text, `${d.id} (${d.unit}): "${text}" reads back as "${formatParam(d, back)}"`);
    }
  }
});
