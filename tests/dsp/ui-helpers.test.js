import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sectionParams } from '../../src/components/instruments/sections.js';
import { panShort, panSpoken, parsePan } from '../../src/components/mixer/pan-text.js';
import { taperFraction, taperValue } from '../../src/components/ui/level-scale.js';
import { SAMPLER_PARAMS } from '../../src/dsp/instruments/sampler-zones.js';

test('parsePan reads a bare number on the 0–100 readout scale', () => {
  assert.equal(parsePan('20'), 0.2);
  assert.equal(parsePan('-20'), -0.2);
  assert.equal(parsePan('−20'), -0.2);
  assert.equal(parsePan('0'), 0);
  assert.equal(parsePan('C'), 0);
  assert.equal(parsePan('centre'), 0);
  assert.equal(parsePan('L20'), -0.2);
  assert.equal(parsePan('r 5'), 0.05);
  assert.equal(parsePan('Left 30'), -0.3);
  assert.equal(parsePan('right 100'), 1);
  assert.equal(parsePan(''), null);
  assert.equal(parsePan('far left'), null);
});

test('pan text round-trips through the readout', () => {
  for (const p of [-1, -0.2, 0, 0.35, 1]) assert.equal(parsePan(panShort(p)), p);
  assert.equal(panSpoken(-0.2), 'Left 20');
  assert.equal(panSpoken(0), 'Centre');
});

test('the fader taper puts 0 dB at the same height for marks and levels', () => {
  assert.equal(taperFraction(6, -60, 6), 1);
  assert.equal(taperFraction(-60, -60, 6), 0);
  assert.ok(Math.abs(taperFraction(0, -60, 6) - (60 / 66) ** 2) < 1e-12);
  assert.equal(taperFraction(12, -60, 6), 1, 'levels above the top clamp');
  for (const db of [-48, -12, 0, 3]) assert.ok(Math.abs(taperValue(taperFraction(db, -60, 6), -60, 6) - db) < 1e-9);
});

test('sectionParams groups a section once, in first-appearance order, enums first', () => {
  const items = sectionParams(SAMPLER_PARAMS);
  const names = items.map((i) => i.section);
  assert.equal(new Set(names).size, names.length, 'no section repeats');
  const playback = items.find((i) => i.section === 'Playback').defs.map((d) => d.id);
  assert.deepEqual(playback, ['trigger', 'voiceMode', 'velSens', 'glide']);
  assert.ok(names.indexOf('Playback') < names.indexOf('Envelope'));
});
