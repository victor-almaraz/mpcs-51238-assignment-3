'use client';

import { useEffect, useRef } from 'react';
import {
  audioTempo,
  clipEndTick,
  deleteClip,
  duplicateClip,
  joinBlocker,
  joinClips,
  moveClip,
  splitClip,
  trimEnd,
  trimStart,
} from '@/lib/project/clip-commands';
import { barText, trackClips } from './layout';

/** Track kind that holds clips of `clip.kind`. */
const trackKindFor = (clip) => (clip.kind === 'midi' ? 'instrument' : 'audio');

/**
 * Timeline commands shared by the keyboard mirror and the pointer layer. Each
 * reads the latest document from a ref (async imports and quick key repeats
 * never act on a stale copy), applies clip commands, calls `onEdit` once and
 * announces the result. `selection` is the selected clip IDs in order.
 */
export default function useTimelineCommands({ project, rowIds, meter, beatTicks, editCursor, selection, setSelection, onEdit, announce, readOnly }) {
  const docRef = useRef(project);
  useEffect(() => {
    docRef.current = project;
  }, [project]);

  function commit(next, message) {
    docRef.current = next;
    onEdit(next);
    if (message) announce(message);
  }

  const selectedClips = (doc = docRef.current) => selection.map((id) => doc.clips[id]).filter(Boolean);

  /** Audio frames in one grid step (a beat) at tick `tick`. */
  function stepFrames(doc, tick) {
    const tempo = audioTempo(doc);
    return tempo.frameAt(tick + beatTicks) - tempo.frameAt(tick);
  }

  /** Moves the selection by `dTick` ticks and `dRow` tracks of the same kind. */
  function move(dTick, dRow = 0) {
    if (readOnly) return;
    let doc = docRef.current;
    const clips = selectedClips(doc);
    if (clips.length === 0) return;
    for (const clip of clips) {
      let toTrackId;
      if (dRow !== 0) {
        const same = rowIds.filter((id) => doc.tracks[id].kind === trackKindFor(clip));
        const at = same.indexOf(clip.trackId) + dRow;
        if (at < 0 || at >= same.length) {
          announce(dRow < 0 ? 'No track above of this kind' : 'No track below of this kind');
          return;
        }
        toTrackId = same[at];
      }
      const result = moveClip(doc, clip.id, dTick, toTrackId);
      if (!result.ok) {
        announce(result.error.message);
        return;
      }
      doc = result.doc;
    }
    const first = doc.clips[clips[0].id];
    commit(doc, `Moved ${first.name} to ${barText(first.start, meter)}, ${doc.tracks[first.trackId].name}`);
  }

  /** Moves the dragged clips onto track row `row` (pointer drop). */
  function moveToRow(dTick, row) {
    const doc = docRef.current;
    const clips = selectedClips(doc);
    const target = rowIds[row];
    if (!target || clips.length === 0) return;
    if (clips.some((c) => doc.tracks[target].kind !== trackKindFor(c))) {
      announce(clips[0].kind === 'midi' ? 'MIDI clips move between instrument tracks only.' : 'Audio clips move between audio tracks only.');
      return;
    }
    let next = doc;
    for (const clip of clips) next = moveClip(next, clip.id, dTick, clips.length === 1 ? target : undefined).doc;
    const first = next.clips[clips[0].id];
    commit(next, `Moved ${first.name} to ${barText(first.start, meter)}, ${next.tracks[first.trackId].name}`);
  }

  /** Trims the selection's start (`edge` 'start') or end by `steps` grid steps, or by `dTick` ticks when given. */
  function trim(edge, steps, dTick) {
    if (readOnly) return;
    let doc = docRef.current;
    const clips = selectedClips(doc);
    for (const clip of clips) {
      let delta;
      if (clip.kind === 'midi') delta = dTick ?? steps * beatTicks;
      else {
        const at = edge === 'start' ? clip.start : clipEndTick(doc, clip);
        if (dTick !== undefined) {
          const tempo = audioTempo(doc);
          delta = tempo.frameAt(Math.max(0, at + dTick)) - tempo.frameAt(at);
        } else delta = steps * stepFrames(doc, steps < 0 ? Math.max(0, at - beatTicks) : at);
      }
      doc = (edge === 'start' ? trimStart : trimEnd)(doc, clip.id, delta).doc;
    }
    if (clips.length === 0) return;
    const c = doc.clips[clips[0].id];
    commit(doc, `${c.name}: ${barText(c.start, meter)} to ${barText(clipEndTick(doc, c), meter)}`);
  }

  /** Splits the selected clips (or the clips under the cursor on `trackId`) at the edit cursor. */
  function split(trackId) {
    if (readOnly) return;
    let doc = docRef.current;
    let clips = selectedClips(doc);
    if (clips.length === 0 && trackId) clips = trackClips(doc, doc.tracks[trackId]);
    clips = clips.filter((c) => c.start < editCursor && editCursor < clipEndTick(doc, c));
    if (clips.length === 0) {
      announce(`No clip at the edit cursor, ${barText(editCursor, meter)}`);
      return;
    }
    const rights = [];
    for (const clip of clips) {
      const result = splitClip(doc, clip.id, editCursor);
      if (!result.ok) {
        announce(result.error.message);
        return;
      }
      doc = result.doc;
      rights.push(result.rightId);
    }
    commit(doc, `Split ${clips[0].name} at ${barText(editCursor, meter)}`);
    setSelection(rights);
  }

  /** Why Join is unavailable for the selection, or null. */
  function joinPair(doc = docRef.current) {
    const clips = selectedClips(doc);
    if (clips.length === 2) {
      const [a, b] = [...clips].sort((x, y) => x.start - y.start);
      return { a, b, reason: joinBlocker(doc, a.id, b.id) };
    }
    if (clips.length === 1) {
      const a = clips[0];
      const end = clipEndTick(doc, a);
      const others = trackClips(doc, doc.tracks[a.trackId]).filter((c) => c.id !== a.id);
      const next = others.find((c) => c.start === end);
      if (next) return { a, b: next, reason: joinBlocker(doc, a.id, next.id) };
      const prev = others.find((c) => clipEndTick(doc, c) === a.start);
      if (prev) return { a: prev, b: a, reason: joinBlocker(doc, prev.id, a.id) };
      return { a, b: null, reason: 'No clip touches this clip.' };
    }
    return { a: null, b: null, reason: 'Select one or two clips to join.' };
  }

  function join() {
    if (readOnly) return;
    const { a, b, reason } = joinPair();
    if (reason) {
      announce(`Cannot join: ${reason}`);
      return;
    }
    commit(joinClips(docRef.current, a.id, b.id).doc, `Joined ${a.name} and ${b.name}`);
    setSelection([a.id]);
  }

  function duplicate() {
    if (readOnly) return;
    let doc = docRef.current;
    const copies = [];
    for (const clip of selectedClips(doc)) {
      const result = duplicateClip(doc, clip.id);
      doc = result.doc;
      copies.push(result.clipId);
    }
    if (copies.length === 0) return [];
    const c = doc.clips[copies[0]];
    commit(doc, `Duplicated ${c.name} to ${barText(c.start, meter)}`);
    setSelection(copies);
    return copies;
  }

  /** Deletes the selection, or the clips `ids` when given. */
  function remove(ids) {
    if (readOnly) return;
    let doc = docRef.current;
    const clips = Array.isArray(ids) ? ids.map((id) => doc.clips[id]).filter(Boolean) : selectedClips(doc);
    for (const clip of clips) doc = deleteClip(doc, clip.id).doc;
    if (clips.length === 0) return;
    commit(doc, clips.length === 1 ? `Deleted ${clips[0].name}` : `Deleted ${clips.length} clips`);
    setSelection([]);
  }

  const clipEnd = (clip) => clipEndTick(docRef.current, clip);

  return { docRef, commit, clipEnd, move, moveToRow, trim, split, join, joinPair, duplicate, remove };
}
