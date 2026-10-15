import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNELS, ENGINE_PROCESSOR, SAFETY_PROCESSOR } from '../../src/dsp/core/constants.js';

test('processor names are distinct non-empty strings', () => {
  assert.equal(typeof ENGINE_PROCESSOR, 'string');
  assert.equal(typeof SAFETY_PROCESSOR, 'string');
  assert.ok(ENGINE_PROCESSOR.length > 0);
  assert.notEqual(ENGINE_PROCESSOR, SAFETY_PROCESSOR);
});

test('processors render stereo', () => {
  assert.equal(CHANNELS, 2);
});
