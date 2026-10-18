import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateLegacyKeys } from '../../src/lib/storage/legacy-names.js';
import { MemoryStorage } from '../support/memory-storage.js';

test('legacy "w-rack:" keys move to "wrack:"; other keys stay', () => {
  const s = new MemoryStorage();
  s.setItem('w-rack:v1:index', '[1]');
  s.setItem('w-rack:v1:settings', '{"metronome":true}');
  s.setItem('other', 'x');
  assert.equal(migrateLegacyKeys(s), 2);
  assert.equal(s.getItem('wrack:v1:index'), '[1]');
  assert.equal(s.getItem('wrack:v1:settings'), '{"metronome":true}');
  assert.equal(s.getItem('w-rack:v1:index'), null);
  assert.equal(s.getItem('other'), 'x');
  assert.equal(migrateLegacyKeys(s), 0);
});

test('a key already saved under the new name wins over its legacy copy', () => {
  const s = new MemoryStorage();
  s.setItem('w-rack:v1:index', 'old');
  s.setItem('wrack:v1:index', 'new');
  assert.equal(migrateLegacyKeys(s), 0);
  assert.equal(s.getItem('wrack:v1:index'), 'new');
  assert.equal(s.getItem('w-rack:v1:index'), null);
});

test('a near-full store still moves a key by freeing its legacy copy first', () => {
  const s = new MemoryStorage();
  const big = 'x'.repeat(100);
  s.setItem('w-rack:v1:project:p', big);
  s.quota = 'w-rack:v1:project:p'.length + big.length + 10;
  assert.equal(migrateLegacyKeys(s), 1);
  assert.equal(s.getItem('wrack:v1:project:p'), big);
  assert.equal(s.getItem('w-rack:v1:project:p'), null);
});
