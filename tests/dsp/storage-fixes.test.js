import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { MemoryStorage } from '../support/memory-storage.js';

globalThis.localStorage = new MemoryStorage();
const store = await import('../../src/lib/project/store.js');
const viewState = await import('../../src/lib/project/view-state.js');
const { createDebouncedWriter, discardPendingWrites } = await import('../../src/lib/storage/storage.js');
const { sourceReferences } = await import('../../src/lib/audio/source-cleanup.js');
const { isArchiveProject, isIsoDate } = await import('../../src/lib/storage/schema.js');
const { migrateLegacyKeys } = await import('../../src/lib/storage/legacy-names.js');
const { saveFile } = await import('../../src/lib/files/save-file.js');

const SOURCE = 'a'.repeat(64);

beforeEach(() => {
  discardPendingWrites();
  localStorage.clear();
  localStorage.quota = Infinity;
  mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => mock.timers.reset());

const projectJson = (id) => JSON.parse(localStorage.getItem(`wrack:v1:project:${id}`));
const create = (name) => store.createProject({ name, tempo: 120, timeSignature: '4/4' }).value;
const withSource = (doc) => ({ ...doc, sources: { [SOURCE]: { id: SOURCE, path: `audio/${SOURCE}.wav` } } });

test('a failed value stays pending when a value for another key arrives', () => {
  let full = true;
  const writes = [];
  const w = createDebouncedWriter({
    write: (v) => (full && v.k === 'a' ? { ok: false, error: 'full' } : (writes.push(v), { ok: true })),
    delayMs: 500,
    keyOf: (v) => v.k,
  });
  w.schedule({ k: 'a', n: 1 });
  w.schedule({ k: 'b', n: 2 });
  assert.deepEqual(w.getState(), { status: 'error', error: 'full' });
  assert.deepEqual(w.pendingFor('a'), { k: 'a', n: 1 }, 'the failed value is kept');
  full = false;
  mock.timers.tick(500);
  assert.deepEqual(writes, [{ k: 'a', n: 1 }, { k: 'b', n: 2 }]);
  assert.equal(w.hasPending(), false);
  assert.equal(w.getState().status, 'saved');
});

test('discard drops one key or every key and clears a failed state', () => {
  const w = createDebouncedWriter({ write: () => ({ ok: false, error: 'full' }), delayMs: 500, keyOf: (v) => v.k });
  w.schedule({ k: 'a' });
  w.schedule({ k: 'b' });
  w.discard('a');
  assert.deepEqual(w.pendingValues(), [{ k: 'b' }]);
  assert.equal(w.getState().status, 'error');
  w.discard();
  assert.equal(w.hasPending(), false);
  assert.deepEqual(w.getState(), { status: 'idle', error: null });
});

test('a failed save of one project survives an edit of another', () => {
  const a = create('A');
  const b = create('B');
  localStorage.quota = 0;
  store.commitEdit({ ...a, name: 'A edited' });
  store.commitEdit({ ...b, name: 'B edited' });
  localStorage.quota = Infinity;
  store.flushSaves();
  assert.equal(projectJson(a.id).name, 'A edited');
  assert.equal(projectJson(b.id).name, 'B edited');
});

test('a rename through saveProject is what loadProject returns and survives a later flush', () => {
  const doc = create('Song');
  localStorage.quota = 0;
  store.commitEdit({ ...doc, name: 'Edited' });
  mock.timers.tick(500);
  localStorage.quota = Infinity;
  const loaded = store.loadProject(doc.id).value;
  assert.equal(loaded.name, 'Edited', 'the pending edit is loaded');
  assert.equal(store.saveProject({ ...loaded, name: 'Renamed' }).ok, true);
  assert.equal(store.loadProject(doc.id).value.name, 'Renamed');
  assert.equal(store.hasUnsavedEdits(), false);
  store.flushSaves();
  assert.equal(projectJson(doc.id).name, 'Renamed');
});

test('a saved edit loads from storage, so a later rewrite is not hidden', () => {
  const doc = create('Song');
  store.commitEdit({ ...doc, name: 'Edited' });
  store.flushSaves();
  store.saveProject({ ...store.loadProject(doc.id).value, name: 'Renamed' });
  assert.equal(store.loadProject(doc.id).value.name, 'Renamed');
});

test('deleting a project drops its failed save and working state', () => {
  const doc = create('Gone');
  localStorage.quota = 0;
  store.commitEdit({ ...doc, name: 'Pending' });
  viewState.saveView(doc.id, viewState.defaultView(doc));
  mock.timers.tick(500);
  localStorage.quota = Infinity;
  assert.deepEqual(store.deleteProject(doc.id), { ok: true });
  assert.equal(store.hasUnsavedEdits(), false);
  store.flushSaves();
  viewState.flushView();
  assert.equal(localStorage.getItem(`wrack:v1:project:${doc.id}`), null);
  assert.equal(localStorage.getItem(`wrack:v1:view:${doc.id}`), null);
  assert.deepEqual(store.listProjects().value, []);
  assert.equal(store.loadProject(doc.id).value, null);
});

test('discardPendingWrites() leaves nothing to write back after Clear all data', () => {
  const doc = create('Song');
  localStorage.quota = 0;
  store.commitEdit({ ...doc, name: 'Pending' });
  mock.timers.tick(500);
  localStorage.quota = Infinity;
  discardPendingWrites();
  localStorage.clear();
  store.flushSaves();
  assert.equal(localStorage.length, 0);
  assert.equal(store.getSaveState().status, 'idle');
});

test('source references include a project whose first save failed', () => {
  localStorage.quota = 0;
  const copy = store.openExampleCopy('beat', 'prj_unsaved-copy');
  store.commitEdit(withSource(copy));
  mock.timers.tick(500);
  localStorage.quota = Infinity;
  const refs = sourceReferences();
  assert.deepEqual(refs.get(SOURCE), [copy.name]);
  assert.ok(store.unsavedDocuments().some((d) => d.id === 'prj_unsaved-copy'));
});

test('source references follow a pending edit in place of its saved copy', () => {
  const doc = create('Song');
  localStorage.quota = 0;
  store.commitEdit(withSource(doc));
  mock.timers.tick(500);
  localStorage.quota = Infinity;
  assert.deepEqual(sourceReferences().get(SOURCE), ['Song'], 'listed once, under the index name');
});

test('isArchiveProject accepts a created project and rejects unusable IDs, dates, tempos and meters', () => {
  const doc = create('Song');
  assert.equal(isArchiveProject(doc), true);
  for (const id of ['', 'prj_', 'prj_a/b', 'prj_a#b', 'prj_a?b', 'prj_a%2F', 'trk_abc', 'prj_' + 'x'.repeat(65)]) {
    assert.equal(isArchiveProject({ ...doc, id }), false, `id ${JSON.stringify(id)}`);
  }
  for (const key of ['createdAt', 'modifiedAt']) {
    for (const value of [undefined, 42, '', 'yesterday', '2026-02-30T00:00:00.000Z x', '2026-13-01T00:00:00.000Z']) {
      assert.equal(isArchiveProject({ ...doc, [key]: value }), false, `${key} ${JSON.stringify(value)}`);
    }
  }
  assert.equal(isArchiveProject({ ...doc, tempo: [{ tick: 0, bpm: '120' }] }), false);
  assert.equal(isArchiveProject({ ...doc, tempo: [null] }), false);
  assert.equal(isArchiveProject({ ...doc, meter: [{ tick: 0, numerator: 0, denominator: 4 }] }), false);
  assert.equal(isArchiveProject({ ...doc, meter: [{ tick: 0, numerator: 4, denominator: 4.5 }] }), false);
  assert.equal(isIsoDate('2026-01-01T00:00:00Z'), true);
});

test('legacy and current project indexes merge by ID; the copy edited last wins', () => {
  const s = new MemoryStorage();
  const entry = (id, name, modifiedAt) => ({ id, name, modifiedAt });
  s.setItem('w-rack:v1:index', JSON.stringify([entry('prj_old', 'Old', '2026-01-01T00:00:00.000Z'), entry('prj_both', 'Legacy', '2026-03-01T00:00:00.000Z')]));
  s.setItem('wrack:v1:index', JSON.stringify([entry('prj_new', 'New', '2026-02-01T00:00:00.000Z'), entry('prj_both', 'Current', '2026-02-01T00:00:00.000Z')]));
  s.setItem('w-rack:v1:project:prj_old', JSON.stringify({ id: 'prj_old', modifiedAt: '2026-01-01T00:00:00.000Z' }));
  s.setItem('w-rack:v1:project:prj_both', JSON.stringify({ id: 'prj_both', name: 'Legacy', modifiedAt: '2026-03-01T00:00:00.000Z' }));
  s.setItem('wrack:v1:project:prj_both', JSON.stringify({ id: 'prj_both', name: 'Current', modifiedAt: '2026-02-01T00:00:00.000Z' }));
  migrateLegacyKeys(s);
  const index = JSON.parse(s.getItem('wrack:v1:index'));
  assert.deepEqual(index.map((e) => [e.id, e.name]).sort(), [['prj_both', 'Legacy'], ['prj_new', 'New'], ['prj_old', 'Old']]);
  assert.equal(JSON.parse(s.getItem('wrack:v1:project:prj_both')).name, 'Legacy');
  assert.ok(s.getItem('wrack:v1:project:prj_old'));
  assert.equal(s.getItem('w-rack:v1:index'), null);
  assert.equal(s.getItem('w-rack:v1:project:prj_both'), null);
});

test('a merged index that does not fit leaves both copies in place', () => {
  const s = new MemoryStorage();
  const legacy = JSON.stringify([{ id: 'prj_a', name: 'A', modifiedAt: '2026-01-01T00:00:00.000Z' }]);
  const current = JSON.stringify([{ id: 'prj_b', name: 'B', modifiedAt: '2026-01-01T00:00:00.000Z' }]);
  s.setItem('w-rack:v1:index', legacy);
  s.setItem('wrack:v1:index', current);
  s.quota = 'w-rack:v1:index'.length + legacy.length + 'wrack:v1:index'.length + current.length;
  migrateLegacyKeys(s);
  assert.equal(s.getItem('w-rack:v1:index'), legacy);
  assert.equal(s.getItem('wrack:v1:index'), current);
});

test('saveFile reports a download as started, not saved', async () => {
  const clicked = [];
  const anchor = { click: () => clicked.push(anchor.download), remove() {} };
  const globals = {
    window: {},
    document: { createElement: () => anchor, body: { append() {} } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  };
  const saved = Object.fromEntries(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  try {
    assert.equal(await saveFile(new Blob(['x']), 'Song.wrack', {}), 'started');
    assert.deepEqual(clicked, ['Song.wrack']);
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
});
