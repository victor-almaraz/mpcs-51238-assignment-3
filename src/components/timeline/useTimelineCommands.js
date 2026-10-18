'use client';

import { getEngine } from '@/lib/audio/engine-client';
import { useEffect, useRef } from 'react';
import {
  audioTempo,
  clipEndTick,
  deleteClip,
  duplicateClip,
  isLooping,
  joinBlocker,
  joinClips,
  loopEnd,
  moveClip,
  setClipLooping,
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
 * announces the result. `selection` is the selected clip IDs in order;
 * `stepTicks` is the snap step that nudges and trims use.
 */
export default function useTimelineCommands({ project, rowIds, meter, stepTicks, editCursor: stoppedCursor, selection, setSelection, onEdit, announce, readOnly }) {
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
    return tempo.frameAt(tick + stepTicks) - tempo.frameAt(tick);
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

  /**
   * Trims the selection's start (`edge` 'start') or end by `steps` grid steps, or by `dTick` ticks when given.
   * Audio clips trim by frames, except the end of a looping clip, which lengthens or shortens the loop by ticks.
   */
  function trim(edge, steps, dTick) {
    if (readOnly) return;
    let doc = docRef.current;
    const clips = selectedClips(doc);
    for (const clip of clips) {
      let delta;
      if (clip.kind === 'midi' || (edge === 'end' && isLooping(clip))) delta = dTick ?? steps * stepTicks;
      else {
        const at = edge === 'start' ? clip.start : clipEndTick(doc, clip);
        if (dTick !== undefined) {
          const tempo = audioTempo(doc);
          delta = tempo.frameAt(Math.max(0, at + dTick)) - tempo.frameAt(at);
        } else delta = steps * stepFrames(doc, steps < 0 ? Math.max(0, at - stepTicks) : at);
      }
      doc = (edge === 'start' ? trimStart : trimEnd)(doc, clip.id, delta).doc;
    }
    if (clips.length === 0) return;
    const c = doc.clips[clips[0].id];
    commit(doc, `${c.name}: ${barText(c.start, meter)} to ${barText(clipEndTick(doc, c), meter)}`);
  }

  /** Lengthens the selected clips by `dTick` ticks as loops, turning looping on at their current length. */
  function repeat(dTick) {
    if (readOnly) return;
    let doc = docRef.current;
    const clips = selectedClips(doc);
    for (const clip of clips) doc = loopEnd(doc, clip.id, dTick).doc;
    if (clips.length === 0) return;
    const c = doc.clips[clips[0].id];
    commit(doc, `${c.name}: loops to ${barText(clipEndTick(doc, c), meter)}`);
  }

  /** Turns looping on or off for the selected clips; off keeps the repeats, as notes (MIDI) or clips (audio). */
  function setLooping(on) {
    if (readOnly) return;
    let doc = docRef.current;
    const clips = selectedClips(doc);
    for (const clip of clips) doc = setClipLooping(doc, clip.id, on).doc;
    if (clips.length === 0) return;
    const kinds = new Set(clips.map((c) => c.kind));
    const kept = kinds.size > 1 ? 'repeats kept' : kinds.has('midi') ? 'repeats kept as notes' : 'repeats kept as clips';
    commit(doc, `${clips.length === 1 ? clips[0].name : `${clips.length} clips`} ${on ? 'looping' : `no longer looping; ${kept}`}`);
  }

  /** Splits the selected clips (or the clips under the cursor on `trackId`) at the edit cursor. */
  function split(trackId) {
    if (readOnly) return;
    // While playing, the split falls at the playhead being heard, not where playback started.
    const engine = getEngine();
    const editCursor = engine.getState().playing ? engine.positionTick() : stoppedCursor;
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
      // Of the touching neighbours (after, then before), the first that can join; else the first one's reason.
      const next = others.find((c) => c.start === end);
      const prev = others.find((c) => clipEndTick(doc, c) === a.start);
      const pairs = [next && { a, b: next }, prev && { a: prev, b: a }].filter(Boolean).map((p) => ({ ...p, reason: joinBlocker(doc, p.a.id, p.b.id) }));
      return pairs.find((p) => !p.reason) ?? pairs[0] ?? { a, b: null, reason: 'No clip touches this clip.' };
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
    const joined = joinClips(docRef.current, a.id, b.id);
    commit(joined.doc, `Joined ${a.name} and ${b.name}`);
    setSelection([joined.clipId]);
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
  const snapStep = () => stepTicks;

  /** Moves track `trackId` up (−1) or down (+1) in the track order. */
  function moveTrack(trackId, dir) {
    if (readOnly) return;
    const doc = docRef.current;
    const order = [...doc.trackOrder];
    const at = order.indexOf(trackId);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= order.length) {
      announce(dir < 0 ? 'Already the first track' : 'Already the last track');
      return;
    }
    [order[at], order[to]] = [order[to], order[at]];
    commit({ ...doc, trackOrder: order }, `${doc.tracks[trackId].name} moved to position ${to + 1}`);
  }

  return { docRef, commit, clipEnd, snapStep, moveTrack, move, moveToRow, trim, repeat, setLooping, split, join, joinPair, duplicate, remove };
}
