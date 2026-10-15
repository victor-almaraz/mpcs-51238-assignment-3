import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { MemoryStorage } from '../support/memory-storage.js';

globalThis.localStorage = new MemoryStorage();
const store = await import('../../src/lib/project/store.js');
const viewState = await import('../../src/lib/project/view-state.js');
const settings = await import('../../src/lib/settings/store.js');
const { migrate } = await import('../../src/lib/storage/migrate.js');
const { estimateUsage, createDebouncedWriter } = await import('../../src/lib/storage/storage.js');
const { createProject } = await import('../../src/lib/project/model.js');

beforeEach(() => {
  localStorage.clear();
  localStorage.quota = Infinity;
  mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => mock.timers.reset());

const projectJson = (id) => JSON.parse(localStorage.getItem(`w-rack:v1:project:${id}`));

test('edits save 500 ms after the last change', () => {
  const doc = store.createProject({ name: 'Song', tempo: 120, timeSignature: '4/4' }).value;
  store.commitEdit({ ...doc, name: 'One' });
  mock.timers.tick(300);
  store.commitEdit({ ...doc, name: 'Two' });
  mock.timers.tick(499);
  assert.equal(projectJson(doc.id).name, 'Song');
  assert.equal(store.getSaveState().status, 'pending');
  mock.timers.tick(1);
  assert.equal(projectJson(doc.id).name, 'Two');
  assert.equal(store.getSaveState().status, 'saved');
  assert.equal(store.listProjects().value[0].name, 'Two', 'the index follows the name');
});

test('flushSaves writes a pending edit at once', () => {
  const doc = store.createProject({ name: 'Song', tempo: 120, timeSignature: '4/4' }).value;
  store.commitEdit({ ...doc, name: 'Now' });
  store.flushSaves();
  assert.equal(projectJson(doc.id).name, 'Now');
});

test('a failed save keeps the edit pending and the previous saved state', () => {
  const doc = store.createProject({ name: 'Song', tempo: 120, timeSignature: '4/4' }).value;
  localStorage.quota = 0;
  store.commitEdit({ ...doc, name: 'Lost?' });
  mock.timers.tick(500);
  assert.deepEqual(store.getSaveState(), { status: 'error', error: store.STORAGE_FULL });
  assert.equal(store.hasUnsavedEdits(), true);
  localStorage.quota = Infinity;
  assert.equal(projectJson(doc.id).name, 'Song');
  store.flushSaves();
  assert.equal(projectJson(doc.id).name, 'Lost?', 'the next flush retries');
  assert.equal(store.hasUnsavedEdits(), false);
});

test('the debounced writer flushes a pending value for another key first', () => {
  const writes = [];
  const w = createDebouncedWriter({ write: (v) => (writes.push(v), { ok: true }), delayMs: 500, keyOf: (v) => v.k });
  w.schedule({ k: 'a', n: 1 });
  w.schedule({ k: 'b', n: 2 });
  assert.deepEqual(writes, [{ k: 'a', n: 1 }]);
  mock.timers.tick(500);
  assert.deepEqual(writes, [{ k: 'a', n: 1 }, { k: 'b', n: 2 }]);
});

test('deleteProject removes the project, its working state and its index entry', () => {
  const doc = store.createProject({ name: 'Gone', tempo: 120, timeSignature: '4/4' }).value;
  viewState.saveView(doc.id, viewState.defaultView(doc));
  viewState.flushView();
  assert.ok(localStorage.getItem(`w-rack:v1:view:${doc.id}`));
  assert.deepEqual(store.deleteProject(doc.id), { ok: true });
  assert.equal(localStorage.getItem(`w-rack:v1:project:${doc.id}`), null);
  assert.equal(localStorage.getItem(`w-rack:v1:view:${doc.id}`), null);
  assert.deepEqual(store.listProjects().value, []);
});

test('working state saves separately and never rewrites the project', () => {
  const doc = store.createProject({ name: 'Song', tempo: 120, timeSignature: '4/4' }).value;
  const before = localStorage.getItem(`w-rack:v1:project:${doc.id}`);
  const trackId = doc.trackOrder[0];
  viewState.saveView(doc.id, { ...viewState.defaultView(doc), zoom: 4, selectedTrackId: trackId, playhead: 3840 });
  mock.timers.tick(500);
  assert.equal(localStorage.getItem(`w-rack:v1:project:${doc.id}`), before);
  const restored = viewState.readView(doc);
  assert.equal(restored.zoom, 4);
  assert.equal(restored.selectedTrackId, trackId);
  assert.equal(restored.playhead, 3840);
});

test('normalizeView drops invalid fields and references to deleted items', () => {
  const doc = createProject({ name: 'x', tempo: 120, timeSignature: '4/4', now: '2026-01-01T00:00:00.000Z' });
  const view = viewState.normalizeView(
    {
      playhead: -5,
      loop: { start: 960, end: 480 },
      loopEnabled: true,
      zoom: 99,
      scrollX: 'far',
      selectedTrackId: 'trk_deleted',
      selectedClipIds: ['clp_deleted'],
      openPanel: 'mixer',
    },
    doc,
  );
  assert.deepEqual(view, viewState.defaultView(doc));
  assert.deepEqual(viewState.normalizeView('not an object', doc), viewState.defaultView(doc));
  const ok = viewState.normalizeView({ loop: { start: 0, end: 7680 }, loopEnabled: true, openPanel: 'pianoroll' }, doc);
  assert.deepEqual([ok.loopEnabled, ok.openPanel, ok.panelClipId], [true, 'pianoroll', null]);
});

test('unreadable working state falls back to the default view', () => {
  const doc = store.createProject({ name: 'Song', tempo: 120, timeSignature: '4/4' }).value;
  localStorage.setItem(`w-rack:v1:view:${doc.id}`, '{broken');
  assert.deepEqual(viewState.readView(doc), viewState.defaultView(doc));
});

test('migrate applies steps in sequence and flags newer documents', () => {
  assert.deepEqual(migrate({ schemaVersion: 1, a: 1 }), { ok: true, value: { schemaVersion: 1, a: 1 }, newer: false });
  assert.equal(migrate({ schemaVersion: 2 }).newer, true);
  const steps = { 1: (d) => ({ ...d, schemaVersion: 2, b: 2 }), 2: (d) => ({ ...d, schemaVersion: 3, c: 3 }) };
  assert.deepEqual(migrate({ schemaVersion: 1 }, steps, 3).value, { schemaVersion: 3, b: 2, c: 3 });
  assert.deepEqual(migrate({ schemaVersion: 1 }, {}, 2), { ok: false });
  assert.throws(() => migrate({ schemaVersion: 1 }, { 1: (d) => d }, 2));
});

test('a project from a newer build opens read-only', () => {
  const doc = store.createProject({ name: 'Future', tempo: 120, timeSignature: '4/4' }).value;
  localStorage.setItem(`w-rack:v1:project:${doc.id}`, JSON.stringify({ ...doc, schemaVersion: 99 }));
  const loaded = store.loadProject(doc.id);
  assert.equal(loaded.readOnly, true);
});

test('settings: defaults, validation, and Remember settings off removes the key', () => {
  assert.equal(settings.getSettings().masterVolumeDb, -12);
  settings.updateSettings({ volumeNoticeDismissed: true, keyboardOctave: 99 });
  const stored = JSON.parse(localStorage.getItem('w-rack:v1:settings'));
  assert.equal(stored.volumeNoticeDismissed, true);
  assert.equal(stored.keyboardOctave, 4, 'out-of-range values take the default');
  settings.setRemember(false);
  assert.equal(localStorage.getItem('w-rack:v1:settings'), null);
  assert.equal(settings.getSettings().volumeNoticeDismissed, false, 'turning it off restores the notice');
  settings.updateSettings({ metronome: true });
  assert.equal(localStorage.getItem('w-rack:v1:settings'), null, 'nothing is written while off');
  settings.setRemember(true);
  assert.equal(JSON.parse(localStorage.getItem('w-rack:v1:settings')).metronome, true);
});

test('estimateUsage counts 2 bytes per code unit of W-Rack keys and values', () => {
  localStorage.setItem('w-rack:v1:index', '[]');
  localStorage.setItem('other', 'ignored');
  assert.equal(estimateUsage(), ('w-rack:v1:index'.length + 2) * 2);
});
