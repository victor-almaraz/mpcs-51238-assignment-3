import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MIN_CLIP_FRAMES,
  addAudioClip,
  audioPasses,
  joinClips,
  loopEnd,
  moveClip,
  setClipLooping,
  trimEnd,
  trimStart,
  unrollAudioLoop,
} from '../../src/lib/project/clip-commands.js';
import { createProject } from '../../src/lib/project/model.js';
import { addNote, createClip, expandClipNotes } from '../../src/lib/project/midi-commands.js';

const FS = 48000; // 120 BPM, PPQ 960, 48 kHz: 25 frames per tick
const SOURCE = { sourceId: 'src_a', name: 'tone.wav', mimeType: 'audio/wav', frames: 96000, rate: FS, channels: [null] };

function ids() {
  let n = 0;
  return (prefix) => `${prefix}_${++n}`;
}

/** A project whose instrument track holds a one-bar MIDI clip at bar 2 with `notes` ({ tick, length }). */
function midiDoc(notes) {
  const makeId = ids();
  let doc = createProject({ name: 'Fixes', tempo: 120, timeSignature: '4/4', now: 0, makeId });
  const trackId = doc.trackOrder[0];
  const made = createClip(doc, trackId, { start: 3840, length: 3840 }, makeId);
  doc = made.doc;
  for (const n of notes) doc = addNote(doc, made.clipId, { ...n, pitch: 60 }, makeId).doc;
  return { doc, clipId: made.clipId, trackId, makeId };
}

/** Adds a MIDI clip right after clip `aId` with `notes`; returns { doc, bId }. */
function appendClip(doc, aId, length, notes, makeId) {
  const a = doc.clips[aId];
  const made = createClip(doc, a.trackId, { start: a.start + a.length, length }, makeId);
  let next = made.doc;
  for (const n of notes) next = addNote(next, made.clipId, { ...n, pitch: 62 }, makeId).doc;
  return { doc: next, bId: made.clipId };
}

const sounding = (clip) => expandClipNotes(clip).map((n) => [n.tick, n.length, n.pitch]);

/** What clips A and B play together, as one clip starting at A. */
function playedPair(doc, aId, bId) {
  const a = doc.clips[aId];
  const b = doc.clips[bId];
  return [...sounding(a), ...sounding(b).map(([t, l, p]) => [t + a.length, l, p])];
}

test('joinClips keeps notes an end trim hid out of the joined MIDI clip', () => {
  const { doc: base, clipId, makeId } = midiDoc([
    { tick: 0, length: 480 },
    { tick: 1440, length: 960 },
    { tick: 2880, length: 480 },
  ]);
  const trimmed = trimEnd(base, clipId, -1920).doc; // A plays 0 and 1440 (cropped to 480)
  const { doc, bId } = appendClip(trimmed, clipId, 3840, [
    { tick: 0, length: 240 },
    { tick: 3000, length: 480 },
  ], makeId);
  const shortB = trimEnd(doc, bId, -1920).doc; // B plays 0 only
  const expected = playedPair(shortB, clipId, bId);
  const joined = joinClips(shortB, clipId, bId, makeId);
  assert.equal(joined.ok, true);
  const clip = joined.doc.clips[joined.clipId];
  assert.equal(clip.length, 3840);
  assert.deepEqual(sounding(clip), expected);
  assert.deepEqual(expected, [
    [0, 480, 60],
    [1440, 480, 60],
    [1920, 240, 62],
  ]);
  // The joined clip lengthened again plays nothing either side hid.
  assert.deepEqual(sounding(trimEnd(joined.doc, joined.clipId, 3840).doc.clips[joined.clipId]), expected);
});

test('joinClips crops a looping MIDI clip, whether it repeats or is shorter than its loop', () => {
  const notes = [
    { tick: 0, length: 480 },
    { tick: 1920, length: 480 },
  ];
  // Repeating: one and a half passes.
  const rep = midiDoc(notes);
  const repeated = loopEnd(rep.doc, rep.clipId, 1920).doc;
  const r = appendClip(repeated, rep.clipId, 960, [{ tick: 0, length: 240 }], rep.makeId);
  const rExpected = playedPair(r.doc, rep.clipId, r.bId);
  const rJoined = joinClips(r.doc, rep.clipId, r.bId, rep.makeId);
  assert.deepEqual(sounding(rJoined.doc.clips[rJoined.clipId]), rExpected);
  assert.equal(rJoined.doc.clips[rJoined.clipId].loopLength, undefined);
  // Shorter than its loop: the note at 1920 is past the clip end and stays silent.
  const short = midiDoc(notes);
  const looped = setClipLooping(short.doc, short.clipId, true).doc;
  const cut = trimEnd(looped, short.clipId, -1920).doc;
  assert.equal(cut.clips[short.clipId].loopLength, 3840);
  const s = appendClip(cut, short.clipId, 1920, [{ tick: 0, length: 240 }], short.makeId);
  const sExpected = playedPair(s.doc, short.clipId, s.bId);
  const sJoined = joinClips(s.doc, short.clipId, s.bId, short.makeId);
  assert.deepEqual(sounding(sJoined.doc.clips[sJoined.clipId]), sExpected);
  assert.deepEqual(sExpected.map(([t]) => t), [0, 1920]);
});

/** A project with a looping two-second audio clip at bar 1 (3840 ticks, one pass). */
function loopingAudio() {
  const makeId = ids();
  const doc = createProject({ name: 'Audio', tempo: 120, timeSignature: '4/4', now: 0, makeId });
  const added = addAudioClip(doc, { trackId: null, tick: 0, source: SOURCE }, makeId);
  return { doc: setClipLooping(added.doc, added.clipId, true).doc, clipId: added.clipId, makeId };
}

test('audioPasses leaves out a last pass shorter than MIN_CLIP_FRAMES, so written-out loops stay valid', () => {
  const { doc, clipId, makeId } = loopingAudio();
  const tiny = trimEnd(doc, clipId, 3840 + 1).doc; // a third pass of 1 tick, 25 frames
  const passes = audioPasses(tiny, tiny.clips[clipId]);
  assert.deepEqual(passes.map((p) => [p.start, p.sourceLength]), [
    [0, 96000],
    [3840, 96000],
  ]);
  const flat = unrollAudioLoop(tiny, clipId, makeId);
  assert.equal(flat.clipIds.length, 2);
  for (const id of flat.clipIds) assert.ok(flat.doc.clips[id].sourceLength >= MIN_CLIP_FRAMES);
  // A last pass of at least MIN_CLIP_FRAMES frames plays.
  const enough = trimEnd(doc, clipId, 3840 + 3).doc; // 75 frames
  assert.deepEqual(audioPasses(enough, enough.clips[clipId]).map((p) => p.sourceLength), [96000, 96000, 75]);
});

test('edits that change nothing return the document itself', () => {
  const { doc, clipId } = loopingAudio();
  assert.equal(moveClip(doc, clipId, -960).doc, doc, 'a clip at bar 1 cannot move left');
  assert.equal(moveClip(doc, clipId, 0).doc, doc);
  const t = trimStart(doc, clipId, -480);
  assert.equal(t.doc, doc, 'the source start bounds the trim; the loop is kept');
  assert.equal(t.doc.clips[clipId].loopLength, 3840);
  const full = loopEnd(doc, clipId, 3840 * 1000).doc; // at the pass limit
  assert.equal(trimEnd(full, clipId, 3840).doc, full);
  const plain = setClipLooping(doc, clipId, false).doc;
  assert.equal(trimEnd(plain, clipId, 100).doc, plain, 'the source end bounds the trim');
  const { doc: midi, clipId: midiId } = midiDoc([]);
  const one = trimEnd(midi, midiId, -3839).doc;
  assert.equal(trimEnd(one, midiId, -10).doc, one);
  assert.equal(trimStart(one, midiId, 10).doc, one);
  // A real change still makes a new document.
  assert.notEqual(moveClip(doc, clipId, 960).doc, doc);
});
