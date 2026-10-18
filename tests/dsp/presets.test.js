import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { MemoryStorage } from '../support/memory-storage.js';

globalThis.localStorage = new MemoryStorage();
const store = await import('../../src/lib/presets/store.js');
const v = await import('../../src/lib/presets/validate.js');
const { createProject } = await import('../../src/lib/project/model.js');

let n = 0;
const makeId = (p) => `${p}_${++n}`;
const save = (name, extra = {}) =>
  store.savePreset({ name, kind: 'instrument', type: 'subtractive', typeLabel: 'Subtractive synth', params: { cutoff: 800 }, ...extra }, { now: '2026-01-01T00:00:00.000Z', makeId });

beforeEach(() => {
  localStorage.clear();
  localStorage.quota = Infinity;
});

test('name rules: required, at most 40 characters, unique per type ignoring case and spaces', () => {
  assert.deepEqual(save('  ').error, { field: 'name', message: 'Enter a preset name.' });
  assert.deepEqual(save('x'.repeat(41)).error, { field: 'name', message: 'Use 40 characters or fewer.' });
  assert.ok(save('Warm pad').ok);
  assert.deepEqual(save(' warm PAD ').error, {
    field: 'name',
    message: 'A preset with this name already exists for Subtractive synth. Choose another name.',
  });
  assert.ok(save('Warm pad', { kind: 'effect', type: 'reverb', typeLabel: 'Reverb', params: {} }).ok);
});

test('the library holds 200 presets; the 201st is refused with the scope message', () => {
  const presets = Array.from({ length: 200 }, (_, i) => ({ id: `pst_${i}`, name: `P${i}`, kind: 'effect', type: 'eq3', params: {} }));
  localStorage.setItem('wrack:v1:presets', JSON.stringify({ schema: 1, presets }));
  assert.equal(store.getPresets().length, 200);
  assert.deepEqual(save('One more').error, { message: 'The preset library is full. Delete a preset in Settings to save a new one.' });
});

test('stored values are clamped and invalid presets dropped on load', () => {
  localStorage.setItem(
    'wrack:v1:presets',
    JSON.stringify({
      schema: 1,
      presets: [
        { id: 'a', name: 'Hot', kind: 'instrument', type: 'subtractive', params: { cutoff: 1e9, resonance: 'loud', bogus: 3 } },
        { id: 'b', name: 'Unknown', kind: 'instrument', type: 'theremin', params: {} },
        { id: 'a', name: 'Duplicate id', kind: 'effect', type: 'eq3', params: {} },
        { id: 'c', name: '', kind: 'effect', type: 'eq3', params: {} },
        null,
      ],
    }),
  );
  const presets = store.getPresets();
  assert.deepEqual(presets.map((p) => p.id), ['a']);
  assert.equal(presets[0].params.cutoff, v.paramDefsFor('instrument', 'subtractive').find((d) => d.id === 'cutoff').max);
  assert.equal(presets[0].params.bogus, undefined);
  assert.ok(Number.isFinite(presets[0].params.resonance));
});

test('rename keeps the rules; delete removes; sampler presets keep the zone without audio', () => {
  const a = save('A').preset;
  save('B');
  assert.equal(store.renamePreset(a.id, 'b', 'Subtractive synth').error.field, 'name');
  assert.ok(store.renamePreset(a.id, 'C', 'Subtractive synth').ok);
  assert.ok(store.deletePreset(a.id).ok);
  assert.deepEqual(store.getPresets().map((p) => p.name), ['B']);
  const s = store.savePreset(
    { name: 'Keys', kind: 'instrument', type: 'sampler', typeLabel: 'Sampler', params: { rootNote: 62 }, sampler: { sourceId: 'abc', sourceName: 'keys.wav', channels: [1] } },
    { makeId },
  ).preset;
  assert.deepEqual(s.sampler, { sourceId: 'abc', sourceName: 'keys.wav' });
});

test('applyPreset replaces parameters (and a sampler zone); null applies the defaults', () => {
  const doc = createProject({ name: 'P', tempo: 120, timeSignature: '4/4', now: '', makeId });
  const deviceId = doc.tracks[doc.trackOrder[0]].deviceIds[0];
  const preset = save('Bright').preset;
  const applied = store.applyPreset(doc, deviceId, preset);
  assert.equal(applied.devices[deviceId].params.cutoff, 800);
  assert.deepEqual(store.applyPreset(applied, deviceId, null).devices[deviceId].params, {});
  assert.equal(v.MAX_PRESETS, 200);
});

test('presets are not part of project JSON', () => {
  save('Lead');
  const doc = createProject({ name: 'P', tempo: 120, timeSignature: '4/4', now: '', makeId });
  assert.equal(JSON.stringify(doc).includes('Lead'), false);
});
