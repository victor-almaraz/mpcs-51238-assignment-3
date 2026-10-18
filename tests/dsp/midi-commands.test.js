import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileModel } from '../../src/lib/audio/compile-model.js';
import {
  addNote, createClip, deleteNote, expandClipNotes, moveNote, noteAt, notesStartingIn, quantize, resizeNote, setLoopLength, setVelocity,
} from '../../src/lib/project/midi-commands.js';
import { setClipLooping } from '../../src/lib/project/clip-commands.js';
import { createProject } from '../../src/lib/project/model.js';

let counter = 0;
const makeId = (prefix) => `${prefix}_${++counter}`;
const BAR = 3840;
const BEAT = 960;

function setup() {
  const doc = createProject({ name: 'x', tempo: 120, timeSignature: '4/4', now: '2026-01-01T00:00:00.000Z', makeId });
  const trackId = doc.trackOrder[0];
  const created = createClip(doc, trackId, {}, makeId);
  assert.equal(created.ok, true);
  return { doc: created.doc, trackId, clipId: created.clipId };
}

test('createClip: a four-bar clip on the track, linked from the track', () => {
  const { doc, trackId, clipId } = setup();
  assert.equal(doc.clips[clipId].length, 4 * BAR);
  assert.deepEqual(doc.tracks[trackId].clipIds, [clipId]);
  assert.equal(createClip(doc, doc.masterTrackId).ok, false, 'not on the master bus');
});

test('add, move, resize, set velocity and delete a note', () => {
  const s = setup();
  let r = addNote(s.doc, s.clipId, { tick: BAR + BEAT, pitch: 60, length: BEAT }, makeId);
  assert.equal(r.ok, true);
  const id = r.noteId;
  let doc = r.doc;
  assert.deepEqual(doc.clips[s.clipId].notes[0], { id, tick: BAR + BEAT, length: BEAT, pitch: 60, velocity: 100, channel: 0 });
  doc = moveNote(doc, s.clipId, id, 240, 2).doc;
  assert.deepEqual([doc.clips[s.clipId].notes[0].tick, doc.clips[s.clipId].notes[0].pitch], [BAR + BEAT + 240, 62]);
  doc = resizeNote(doc, s.clipId, id, -2000, 240).doc;
  assert.equal(doc.clips[s.clipId].notes[0].length, 240, 'length stops at the minimum');
  doc = setVelocity(doc, s.clipId, id, 300).doc;
  assert.equal(doc.clips[s.clipId].notes[0].velocity, 127);
  doc = deleteNote(doc, s.clipId, id).doc;
  assert.deepEqual(doc.clips[s.clipId].notes, []);
  assert.equal(s.doc.clips[s.clipId].notes.length, 0, 'the original document is unchanged');
});

test('moves are clamped: start inside the clip, pitch 0–127', () => {
  const s = setup();
  const r = addNote(s.doc, s.clipId, { tick: 0, pitch: 126, length: BEAT }, makeId);
  const moved = moveNote(r.doc, s.clipId, r.noteId, -BEAT, 5).doc.clips[s.clipId].notes[0];
  assert.deepEqual([moved.tick, moved.pitch], [0, 127]);
  const late = moveNote(r.doc, s.clipId, r.noteId, 100 * BAR, 0).doc.clips[s.clipId].notes[0];
  assert.equal(late.tick, 4 * BAR - 1);
});

test('fractional ticks are rejected', () => {
  const s = setup();
  assert.throws(() => addNote(s.doc, s.clipId, { tick: 0.5, pitch: 60, length: BEAT }));
  const r = addNote(s.doc, s.clipId, { tick: 0, pitch: 60, length: BEAT }, makeId);
  assert.throws(() => moveNote(r.doc, s.clipId, r.noteId, 1.5, 0));
  assert.throws(() => resizeNote(r.doc, s.clipId, r.noteId, 0.25));
  assert.throws(() => quantize(r.doc, s.clipId, 240.5));
});

test('invalid notes fail with a code', () => {
  const s = setup();
  assert.equal(addNote(s.doc, s.clipId, { tick: 4 * BAR, pitch: 60, length: BEAT }).error.code, 'invalid');
  assert.equal(addNote(s.doc, s.clipId, { tick: 0, pitch: 128, length: BEAT }).error.code, 'invalid');
  assert.equal(addNote(s.doc, 'clp_none', { tick: 0, pitch: 60, length: BEAT }).error.code, 'missing');
  assert.equal(deleteNote(s.doc, s.clipId, 'nte_none').error.code, 'missing');
});

test('quantize moves starts to the nearest grid line and keeps lengths', () => {
  const s = setup();
  let doc = s.doc;
  const ids = [];
  for (const tick of [100, 130, 470, 4 * BAR - 10]) {
    const r = addNote(doc, s.clipId, { tick, pitch: 60, length: 333 }, makeId);
    doc = r.doc;
    ids.push(r.noteId);
  }
  const all = quantize(doc, s.clipId, 240).doc.clips[s.clipId].notes;
  assert.deepEqual(all.map((n) => n.tick), [0, 240, 480, 4 * BAR - 240]);
  assert.ok(all.every((n) => n.length === 333));
  const some = quantize(doc, s.clipId, 240, [ids[0]]).doc.clips[s.clipId].notes;
  assert.deepEqual(some.map((n) => n.tick), [0, 130, 470, 4 * BAR - 10]);
});

test('noteAt finds the note starting in a cell or covering it', () => {
  const s = setup();
  const r = addNote(s.doc, s.clipId, { tick: 240, pitch: 64, length: BEAT }, makeId);
  const clip = r.doc.clips[s.clipId];
  assert.equal(noteAt(clip, 240, 64, 240).id, r.noteId);
  assert.equal(noteAt(clip, 480, 64, 240).id, r.noteId, 'covering');
  assert.equal(noteAt(clip, 1200, 64, 240), undefined);
  assert.equal(noteAt(clip, 240, 65, 240), undefined);
});

test('loop expansion: notes repeat every loopLength and are cropped at the clip end', () => {
  const clip = {
    length: 10 * BEAT,
    loopLength: 4 * BEAT,
    notes: [
      { tick: 0, length: BEAT, pitch: 60, velocity: 100 },
      { tick: 3 * BEAT, length: 2 * BEAT, pitch: 64, velocity: 90 },
      { tick: 5 * BEAT, length: BEAT, pitch: 67, velocity: 80 }, // beyond the loop: silent
    ],
  };
  const out = expandClipNotes(clip);
  assert.deepEqual(
    out.map((n) => [n.tick / BEAT, n.length / BEAT, n.pitch]),
    [[0, 1, 60], [3, 1, 64], [4, 1, 60], [7, 1, 64], [8, 1, 60]],
    'a note crossing the loop end is cut at the loop length; the last repeat crops at the clip end',
  );
});

test('loop expansion: no loop plays notes once; the cap limits expansion', () => {
  const clip = { length: 4 * BEAT, notes: [{ tick: 3 * BEAT, length: 4 * BEAT, pitch: 60, velocity: 100 }] };
  assert.deepEqual(expandClipNotes(clip), [{ tick: 3 * BEAT, length: BEAT, pitch: 60, velocity: 100 }]);
  const dense = { length: 1000 * BEAT, loopLength: 1, notes: [{ tick: 0, length: 1, pitch: 60, velocity: 100 }] };
  assert.equal(expandClipNotes(dense, 20000).length, 20000);
});

test('compile: a looping clip expands into frames, sorted, at most 20 000 notes per track', () => {
  const s = setup();
  let doc = setLoopLength(s.doc, s.clipId, BAR).doc;
  doc = addNote(doc, s.clipId, { tick: BEAT, pitch: 72, length: BEAT }, makeId).doc;
  doc = addNote(doc, s.clipId, { tick: 0, pitch: 60, length: BEAT }, makeId).doc;
  const { model } = compileModel(doc, 48000);
  const notes = model.tracks[0].notes;
  assert.deepEqual([...notes.pitch], [60, 72, 60, 72, 60, 72, 60, 72]);
  assert.deepEqual([...notes.start].slice(0, 4), [0, 24000, 96000, 120000]);
  // Ending the loop writes its repeats out: the clip compiles to the same notes.
  const off = setClipLooping(doc, s.clipId, false, makeId).doc;
  assert.equal(off.clips[s.clipId].loopLength, undefined);
  assert.equal(off.clips[s.clipId].notes.length, 8);
  assert.deepEqual([...compileModel(off, 48000).model.tracks[0].notes.start], [...notes.start]);
});

test('noteAt with startOnly matches drum markers: a long note does not cover later cells', () => {
  const clip = { notes: [{ id: 'a', tick: 0, length: 960, pitch: 36, velocity: 100 }] };
  assert.equal(noteAt(clip, 240, 36, 240)?.id, 'a', 'pitched rows: the note covers the cell');
  assert.equal(noteAt(clip, 240, 36, 240, true), undefined, 'drum rows: only notes starting there');
  assert.equal(noteAt(clip, 0, 36, 240, true)?.id, 'a');
});

test('notesStartingIn lists stacked notes of one pitch in a cell', () => {
  const clip = { notes: [
    { id: 'a', tick: 0, length: 240, pitch: 60, velocity: 100 },
    { id: 'b', tick: 120, length: 240, pitch: 60, velocity: 100 },
    { id: 'c', tick: 0, length: 240, pitch: 61, velocity: 100 },
  ] };
  assert.deepEqual(notesStartingIn(clip, 0, 60, 240).map((n) => n.id), ['a', 'b']);
});
