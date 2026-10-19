import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addNote, createClip, editableLength, moveNote, quantize, resizeNote, setLoopLength, setNoteSpan,
} from '../../src/lib/project/midi-commands.js';
import { createProject } from '../../src/lib/project/model.js';

let counter = 0;
const makeId = (prefix) => `${prefix}_${++counter}`;
const BAR = 3840;
const BEAT = 960;
const STEP = 240;

/** A four-bar clip with notes of `length` ticks at `ticks`; returns the document, clip ID and note IDs. */
function clipWith(ticks, length = BEAT) {
  const doc0 = createProject({ name: 'x', tempo: 120, timeSignature: '4/4', now: '2026-01-01T00:00:00.000Z', makeId });
  const made = createClip(doc0, doc0.trackOrder[0], {}, makeId);
  let doc = made.doc;
  const ids = [];
  for (const tick of ticks) {
    const r = addNote(doc, made.clipId, { tick, pitch: 60, length }, makeId);
    assert.equal(r.ok, true);
    doc = r.doc;
    ids.push(r.noteId);
  }
  return { doc, clipId: made.clipId, ids };
}

/** `doc` with clip `clipId` given `length`, as a trim of its end leaves it. */
function trimmed(doc, clipId, length) {
  return { ...doc, clips: { ...doc.clips, [clipId]: { ...doc.clips[clipId], length } } };
}

const ticksOf = (doc, clipId) => doc.clips[clipId].notes.map((n) => n.tick);

test('editableLength: the clip length, or a shorter loop length', () => {
  assert.equal(editableLength({ length: 4 * BAR }), 4 * BAR);
  assert.equal(editableLength({ length: 4 * BAR, loopLength: BAR }), BAR);
  assert.equal(editableLength({ length: BAR, loopLength: 2 * BAR }), BAR);
});

test('quantize leaves notes a trim hid in place and counts only the notes it moved', () => {
  const s = clipWith([130, BAR + 10, 2 * BAR + 50, 3 * BAR + 70]);
  const doc = trimmed(s.doc, s.clipId, BAR + 100);
  const r = quantize(doc, s.clipId, STEP);
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.deepEqual(ticksOf(r.doc, s.clipId), [STEP, BAR, 2 * BAR + 50, 3 * BAR + 70], 'hidden notes keep their ticks');
});

test('quantize in a looping clip moves only the loop notes and keeps them inside the loop', () => {
  const s = clipWith([BAR - 10, 2 * BAR + 50]);
  const doc = setLoopLength(s.doc, s.clipId, BAR).doc;
  const r = quantize(doc, s.clipId, STEP);
  assert.equal(r.count, 1);
  assert.deepEqual(ticksOf(r.doc, s.clipId), [BAR - STEP, 2 * BAR + 50]);
  assert.equal(quantize(doc, s.clipId, STEP, [s.ids[1]]).count, 0, 'a selection outside the loop quantizes nothing');
});

test('a looping clip edits only its loop: add, move and span stay inside it', () => {
  const s = clipWith([0]);
  const doc = setLoopLength(s.doc, s.clipId, BAR).doc;
  assert.equal(addNote(doc, s.clipId, { tick: BAR, pitch: 62, length: BEAT }, makeId).error.code, 'invalid');
  assert.equal(addNote(doc, s.clipId, { tick: BAR - 1, pitch: 62, length: BEAT }, makeId).ok, true);
  assert.equal(moveNote(doc, s.clipId, s.ids[0], 3 * BAR, 0).note.tick, BAR - 1);
  assert.equal(setNoteSpan(doc, s.clipId, s.ids[0], 2 * BAR, BEAT).note.tick, BAR - 1);
});

test('resizeNote never lengthens a note shorter than the minimum on a shrink', () => {
  const s = clipWith([0], 100);
  const r = resizeNote(s.doc, s.clipId, s.ids[0], -STEP, STEP);
  assert.equal(r.ok, true);
  assert.equal(r.doc, s.doc, 'a shrink that cannot happen leaves the document as it was');
  assert.equal(r.note.length, 100);
  assert.equal(resizeNote(s.doc, s.clipId, s.ids[0], STEP, STEP).note.length, 100 + STEP, 'it still grows');
});

test('resizeNote shrinks a longer note down to the minimum and no further', () => {
  const s = clipWith([0], 300);
  assert.equal(resizeNote(s.doc, s.clipId, s.ids[0], -STEP, STEP).note.length, STEP);
  assert.equal(resizeNote(s.doc, s.clipId, s.ids[0], -1000, 1).note.length, 1);
  assert.equal(resizeNote(s.doc, s.clipId, 'nte_none', -STEP, STEP).error.code, 'missing');
});
