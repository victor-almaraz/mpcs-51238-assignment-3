'use client';

import { useEffect, useRef } from 'react';
import { getEngine } from '@/lib/audio/engine-client';
import {
  addNote, createClip, deleteNote, moveNote, noteAt, quantize, resizeNote, setLoopLength, setVelocity,
} from '@/lib/project/midi-commands';
import { noteText } from './layout';

/**
 * Piano-roll edits through the note commands (midi-commands.js). Pointer,
 * keyboard and step input all call these, so no input path edits the document
 * directly. Commands read the newest document from a ref that each commit
 * updates synchronously, so events arriving faster than React renders (a MIDI
 * chord in step input) build on each other instead of overwriting each other.
 * Each command applies `onEdit(nextDoc)`, announces the result and, with
 * preview on, plays the note (PR-02).
 */
export default function usePianoRollCommands({
  project, trackId, clipId, grid, isDrums, meter, preview, onEdit, onClipCreated, announce, readOnly,
}) {
  const engine = getEngine();
  const docRef = useRef(project);
  const clipIdRef = useRef(clipId);
  useEffect(() => {
    docRef.current = project;
    clipIdRef.current = clipId;
  });

  const describe = (note) => noteText(note, isDrums, meter, grid);
  const sound = (note) => {
    if (preview) engine.preview(note.pitch, note.velocity);
  };
  const currentClip = () => {
    const clip = clipIdRef.current ? docRef.current.clips[clipIdRef.current] : null;
    return clip?.kind === 'midi' ? clip : null;
  };
  const findNote = (noteId) => currentClip()?.notes.find((n) => n.id === noteId);

  function commit(result, message) {
    if (!result.ok) {
      announce(result.error.message);
      return false;
    }
    docRef.current = result.doc;
    onEdit(result.doc);
    if (message) announce(message);
    return true;
  }

  const commands = {
    /** Length of the clip being edited, in ticks (a new clip's length when there is none). */
    clipLength: (fallback) => currentClip()?.length ?? fallback,

    /** The note at a cell in the newest document (drum rows: notes starting there only). */
    noteIn: (tick, pitch) => {
      const clip = currentClip();
      return clip ? noteAt(clip, tick, pitch, grid, isDrums) : undefined;
    },

    /**
     * Adds a grid-length note at clip tick `tick` and `pitch`, creating the
     * track's clip if needed. `sounds: false` skips the preview (step input,
     * where the played note already sounds). Returns the note, or null.
     */
    add(tick, pitch, { sounds = true } = {}) {
      if (readOnly) return null;
      let doc = docRef.current;
      let id = currentClip()?.id;
      if (!id) {
        const created = createClip(doc, trackId);
        if (!commit(created)) return null;
        doc = created.doc;
        id = created.clipId;
        clipIdRef.current = id;
        onClipCreated(id);
      }
      const result = addNote(doc, id, { tick, pitch, length: grid });
      if (!result.ok) {
        commit(result);
        return null;
      }
      const note = result.doc.clips[id].notes.find((n) => n.id === result.noteId);
      commit(result, `Added ${describe(note)}`);
      if (sounds) sound(note);
      return note;
    },

    /** Enter on a cell: removes the note there, or adds one. Returns the note added, or null. */
    toggle(tick, pitch) {
      const existing = commands.noteIn(tick, pitch);
      if (existing) {
        commands.remove(existing.id);
        return null;
      }
      return commands.add(tick, pitch);
    },

    remove(noteId) {
      const clip = currentClip();
      const note = findNote(noteId);
      if (readOnly || !clip || !note) return;
      commit(deleteNote(docRef.current, clip.id, noteId), `Removed ${describe(note)}`);
    },

    /** Moves a note by `dTick` ticks and `dPitch` semitones; previews a transposed note. Returns the moved note. */
    move(noteId, dTick, dPitch) {
      const clip = currentClip();
      if (readOnly || !clip) return null;
      const result = moveNote(docRef.current, clip.id, noteId, dTick, dPitch);
      if (!commit(result, result.ok ? `Moved to ${describe(result.note)}` : undefined)) return null;
      if (dPitch !== 0) sound(result.note);
      return result.note;
    },

    resize(noteId, dTicks) {
      const clip = currentClip();
      if (readOnly || !clip) return;
      const result = resizeNote(docRef.current, clip.id, noteId, dTicks, grid);
      commit(result, result.ok ? describe(result.note) : undefined);
    },

    velocity(noteId, delta) {
      const clip = currentClip();
      const note = findNote(noteId);
      if (readOnly || !clip || !note) return;
      const result = setVelocity(docRef.current, clip.id, noteId, note.velocity + delta);
      commit(result, result.ok ? `Velocity ${result.note.velocity}` : undefined);
    },

    quantize() {
      const clip = currentClip();
      if (readOnly || !clip) return;
      commit(quantize(docRef.current, clip.id, grid), `Quantized ${clip.notes.length} notes to the grid`);
    },

    /** Sets the clip's loop length in ticks, or turns looping off with null. */
    setLoop(ticks) {
      const clip = currentClip();
      if (readOnly || !clip) return;
      commit(setLoopLength(docRef.current, clip.id, ticks), ticks ? 'Clip loop on' : 'Clip loop off');
    },

    /** Selecting a note previews and names it. */
    select(note) {
      sound(note);
      announce(describe(note));
    },
  };
  return commands;
}
