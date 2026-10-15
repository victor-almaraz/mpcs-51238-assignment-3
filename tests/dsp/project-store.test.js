import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { MemoryStorage } from '../support/memory-storage.js';

globalThis.localStorage = new MemoryStorage();
const store = await import('../../src/lib/project/store.js');
const { EXAMPLES } = await import('../../src/lib/project/examples.js');
const { hasAnyWrackKey } = await import('../../src/lib/storage/storage.js');

beforeEach(() => {
  localStorage.clear();
  localStorage.quota = Infinity;
});

test('createProject saves the project and an index entry', () => {
  const result = store.createProject({ name: 'Song', tempo: 120, timeSignature: '4/4' }, '2026-02-01T00:00:00.000Z');
  assert.equal(result.ok, true);
  const listed = store.listProjects();
  assert.deepEqual(listed.value.map((e) => e.name), ['Song']);
  assert.equal(store.loadProject(result.value.id).value.name, 'Song');
});

test('listProjects is most recently edited first', () => {
  store.createProject({ name: 'Old', tempo: 120, timeSignature: '4/4' }, '2026-01-01T00:00:00.000Z');
  store.createProject({ name: 'New', tempo: 120, timeSignature: '4/4' }, '2026-03-01T00:00:00.000Z');
  assert.deepEqual(store.listProjects().value.map((e) => e.name), ['New', 'Old']);
});

test('unreadable JSON is reported, not thrown', () => {
  localStorage.setItem('w-rack:v1:project:prj_x', '{not json');
  assert.deepEqual(store.loadProject('prj_x'), { ok: false, error: store.PROJECT_UNREADABLE });
  localStorage.setItem('w-rack:v1:index', '"not a list"');
  assert.deepEqual(store.listProjects(), { ok: false, error: store.PROJECT_UNREADABLE });
});

test('a missing project loads as null', () => {
  assert.deepEqual(store.loadProject('prj_missing'), { ok: true, value: null, readOnly: false });
});

test('a quota error keeps the previous state and returns the scope message', () => {
  const first = store.createProject({ name: 'Kept', tempo: 120, timeSignature: '4/4' });
  localStorage.quota = 0;
  const second = store.createProject({ name: 'Lost', tempo: 120, timeSignature: '4/4' });
  assert.deepEqual(second, { ok: false, error: store.STORAGE_FULL });
  localStorage.quota = Infinity;
  assert.deepEqual(store.listProjects().value.map((e) => e.id), [first.value.id]);
});

test('an example copy stays unsaved until its first edit', () => {
  const id = 'prj_copy-test';
  const copy = store.openExampleCopy('beat', id, '2026-04-01T00:00:00.000Z');
  assert.equal(copy.name, 'Beat (copy)');
  assert.equal(store.isUnsavedCopy(id), true);
  assert.equal(hasAnyWrackKey(), false, 'opening writes nothing');
  assert.equal(store.loadProject(id).value, copy);

  store.commitEdit({ ...copy, name: 'My beat' }, '2026-04-01T00:01:00.000Z');
  assert.equal(store.isUnsavedCopy(id), true, 'the save waits for the debounce');
  assert.equal(store.flushSaves().status, 'saved');
  assert.equal(store.isUnsavedCopy(id), false);
  assert.deepEqual(store.listProjects().value.map((e) => e.name), ['My beat']);
  assert.equal(EXAMPLES[0].doc.name, 'Beat', 'the example itself never changes');
});

test('examples use six synthesized instruments and every effect type, and no audio', () => {
  const types = new Set(EXAMPLES.flatMap((e) => Object.values(e.doc.devices).map((d) => d.type)));
  for (const t of ['subtractive', 'fm', 'additive', 'pluck', 'granular', 'drums']) assert.ok(types.has(t), t);
  for (const t of ['eq3', 'filter', 'compressor', 'saturation', 'delay', 'reverb']) assert.ok(types.has(t), t);
  assert.ok(!types.has('sampler'));
  for (const e of EXAMPLES) {
    assert.deepEqual(e.doc.sources, {});
    for (const clip of Object.values(e.doc.clips)) {
      assert.equal(clip.kind, 'midi');
      for (const n of clip.notes) {
        assert.ok(Number.isInteger(n.tick) && Number.isInteger(n.length) && n.length >= 1);
        assert.ok(n.tick + n.length <= clip.length, `${n.id} fits its clip`);
        assert.ok(n.velocity >= 1 && n.velocity <= 127 && n.pitch >= 0 && n.pitch <= 127);
      }
    }
  }
});
