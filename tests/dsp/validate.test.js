import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createId, createProject, nextUntitledName, parseTimeSignature, ticksPerBar } from '../../src/lib/project/model.js';
import {
  NAME_EMPTY,
  NAME_TOO_LONG,
  TEMPO_INVALID,
  validateNewProject,
  validateProjectName,
  validateTempo,
} from '../../src/lib/project/validate.js';

test('error texts match the scope exactly', () => {
  assert.equal(NAME_EMPTY, 'Enter a project name.');
  assert.equal(NAME_TOO_LONG, 'Use 60 characters or fewer.');
  assert.equal(TEMPO_INVALID, 'Enter a whole-number tempo from 40 to 240.');
});

test('project name: 1–60 characters after trimming', () => {
  assert.equal(validateProjectName(''), NAME_EMPTY);
  assert.equal(validateProjectName('   '), NAME_EMPTY);
  assert.equal(validateProjectName('a'), null);
  assert.equal(validateProjectName('x'.repeat(60)), null);
  assert.equal(validateProjectName(`  ${'x'.repeat(60)}  `), null);
  assert.equal(validateProjectName('x'.repeat(61)), NAME_TOO_LONG);
  assert.equal(validateProjectName('🎹'.repeat(60)), null, 'counts code points, not UTF-16 units');
});

test('tempo: integer 40–240', () => {
  for (const ok of ['40', '120', '240', ' 90 ']) assert.equal(validateTempo(ok), null, ok);
  for (const bad of ['39', '241', 'abc', '', '120.5', '-50', '1e2', '0x50']) {
    assert.equal(validateTempo(bad), TEMPO_INVALID, bad);
  }
});

test('validateNewProject returns trimmed values or field errors', () => {
  assert.deepEqual(validateNewProject({ name: ' Song ', tempo: '96', timeSignature: '3/4' }), {
    ok: true,
    value: { name: 'Song', tempo: 96, timeSignature: '3/4' },
  });
  assert.deepEqual(validateNewProject({ name: '', tempo: 'abc', timeSignature: '4/4' }), {
    ok: false,
    errors: { name: NAME_EMPTY, tempo: TEMPO_INVALID },
  });
  assert.equal(validateNewProject({ name: 'a', tempo: '120', timeSignature: '7/8' }).ok, true);
  assert.throws(() => validateNewProject({ name: 'a', tempo: '120', timeSignature: '5/3' }));
});

test('parseTimeSignature: 1–32 beats over a note value from 1 to 32', () => {
  assert.deepEqual(parseTimeSignature('7/8'), { numerator: 7, denominator: 8 });
  assert.deepEqual(parseTimeSignature('32/32'), { numerator: 32, denominator: 32 });
  assert.deepEqual(parseTimeSignature('1/1'), { numerator: 1, denominator: 1 });
  for (const bad of ['0/4', '33/4', '4/3', '4/64', '4/0', '4', '4/4/4', ' 4/4', '', null]) assert.equal(parseTimeSignature(bad), null, String(bad));
});

test('nextUntitledName picks the lowest unused number', () => {
  assert.equal(nextUntitledName([]), 'Untitled project 1');
  assert.equal(nextUntitledName(['Untitled project 1', 'Untitled project 3']), 'Untitled project 2');
  assert.equal(nextUntitledName(['Untitled project 2', 'Other']), 'Untitled project 1');
});

test('createId: prefix plus 21 URL-safe characters', () => {
  const id = createId('prj');
  assert.match(id, /^prj_[A-Za-z0-9_-]{21}$/);
  assert.equal(createId('trk', (n) => new Uint8Array(n)), `trk_${'A'.repeat(21)}`);
});

test('createProject: one empty instrument track routed to a −12 dB master', () => {
  const doc = createProject({ name: 'Song', tempo: 96, timeSignature: '6/8', now: '2026-01-01T00:00:00.000Z' });
  assert.equal(doc.schemaVersion, 1);
  assert.deepEqual(doc.tempo, [{ tick: 0, bpm: 96, shape: 'step' }]);
  assert.deepEqual(doc.meter, [{ tick: 0, numerator: 6, denominator: 8 }]);
  assert.equal(doc.trackOrder.length, 1);
  const track = doc.tracks[doc.trackOrder[0]];
  assert.equal(track.kind, 'instrument');
  assert.deepEqual(track.clipIds, []);
  assert.equal(track.output, doc.masterTrackId);
  assert.equal(doc.devices[track.deviceIds[0]].type, 'subtractive');
  assert.equal(doc.tracks[doc.masterTrackId].gainDb, -12);
});

test('ticksPerBar follows the meter', () => {
  assert.equal(ticksPerBar(4, 4), 3840);
  assert.equal(ticksPerBar(6, 8), 2880);
});
