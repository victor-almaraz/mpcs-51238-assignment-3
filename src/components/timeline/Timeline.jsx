'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import Toggle from '@/components/ui/Toggle';
import Toolbar from '@/components/ui/Toolbar';
import useThrottledAnnouncer from '@/components/ui/useThrottledAnnouncer';
import useCommands from '@/components/commands/useCommands';
import { cx } from '@/design-systems/industrial/classes';
import { PPQ } from '@/dsp/core/constants';
import { MeterMap } from '@/dsp/timing/meter-map';
import { getSource, importFiles } from '@/lib/audio/decode';
import { getEngine } from '@/lib/audio/engine-client';
import { faderText } from '@/components/mixer/TrackStrip';
import { gainToDb } from '@/dsp/core/math';
import {
  CLIP_GAIN_MAX_DB,
  CLIP_GAIN_MIN_DB,
  addAudioClip,
  addAudioTrack,
  addEnvelopePoint,
  addInstrumentTrack,
  clipEndTick,
  removeEnvelopePoint,
  removeTrack,
  setClipGain,
  setEnvelopePoint,
  setFade,
} from '@/lib/project/clip-commands';
import { INSTRUMENT_LABELS, setTrack, ticksPerBar } from '@/lib/project/model';
import { createClip } from '@/lib/project/midi-commands';
import { ZOOM_MAX, ZOOM_MIN, stepGrid, stepZoom } from '@/lib/project/view-state';
import ClipMenu from './ClipMenu';
import TimelineCanvas from './TimelineCanvas';
import TimelineTree from './TimelineTree';
import useTimelineCommands from './useTimelineCommands';
import {
  EDGE_PX,
  HEADER_W,
  GAIN_DB_PER_PX,
  RULER_H,
  TAIL_BARS,
  TRACK_H,
  barText,
  clipAt,
  clipRect,
  contentEnd,
  envelopePointAt,
  frameAtX,
  gainAtY,
  handleAt,
  pxPerTick,
  sourceStatus,
  tickToX,
  trackClips,
  xToTick,
} from './layout';

/** Envelope gain in dB for readouts; 0 is −∞. */
const gainDb = (g) => (g <= 0 ? -Infinity : gainToDb(g));

const ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga';
/** Snap grids (ARR-04), the order of SNAP_GRIDS; 'bar' snaps to the bar. */
const SNAP_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: '1', label: '1/4' },
  { value: '0.5', label: '1/8' },
  { value: '0.25', label: '1/16' },
];
const INSTRUMENT_OPTIONS = Object.entries(INSTRUMENT_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Arrangement timeline (assignment-3-scope.md, Audio clips): "Add audio
 * file", clip commands, a canvas picture with pointer editing, and the
 * "Tracks and clips" treegrid mirror for the keyboard and assistive
 * technology. Pointer and keys call the same commands. The edit cursor is the
 * playhead while stopped; selection is saved with the working state.
 */
export default function Timeline({ project, view, onViewChange, onEdit, readOnly, loading, onOpenProperties }) {
  const engine = getEngine();
  const meter = useMemo(() => new MeterMap(project.meter), [project.meter]);
  const { numerator, denominator } = project.meter[0];
  const barTicks = ticksPerBar(numerator, denominator);
  const rowIds = project.trackOrder.filter((id) => project.tracks[id]);
  const selection = view.selectedClipIds.filter((id) => project.clips[id]);
  const editCursor = view.playhead;
  const [announcement, announce] = useThrottledAnnouncer();
  const [results, setResults] = useState([]);
  const [importing, setImporting] = useState(false);
  const [ghost, setGhostState] = useState(null);
  // The latest preview also lives in a ref: a release can arrive before React renders the last move.
  const ghostRef = useRef(null);
  const setGhost = (g) => {
    ghostRef.current = g;
    setGhostState(g);
  };
  const [newInstrument, setNewInstrument] = useState('subtractive');
  const [menu, setMenu] = useState(null); // { clipId, x, y, returnFocus }
  const [doomedTrackId, setDoomedTrackId] = useState(null); // a track with clips awaiting confirmation
  const cancelDeleteRef = useRef(null);
  // Keyboard nudges always step by the grid; pointer drags follow it while snap is on.
  const stepTicks = view.snap === 'bar' ? barTicks : Number(view.snap) * PPQ;
  const snapTick = (t, free) => (free || !view.snapOn ? t : Math.round(t / stepTicks) * stepTicks);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const canvasRef = useRef(null);
  const scrollSave = useRef(0);
  const drag = useRef(null);

  // Selecting clips also selects the last one's track, so the dock shows that clip.
  const setSelection = (ids) => {
    const last = project.clips[ids[ids.length - 1]];
    onViewChange(last ? { selectedClipIds: ids, selectedTrackId: last.trackId } : { selectedClipIds: ids });
  };
  const commands = useTimelineCommands({
    project,
    rowIds,
    meter,
    stepTicks,
    editCursor,
    selection,
    setSelection,
    onEdit,
    announce,
    readOnly,
  });
  const statusFor = (clip) => sourceStatus(clip.sourceId, getSource, loading);
  const joinState = commands.joinPair(project);
  const hasClips = Object.keys(project.clips).length > 0;
  const showJoin = selection.length > 0;
  const focusTree = () => document.querySelector('[role="treegrid"][aria-label="Tracks and clips"] [role="row"][tabindex="0"]')?.focus();
  const editable = () => !readOnly;
  useCommands([
    { id: 'timeline.add-audio', group: 'Timeline', label: 'Add audio file…', run: () => fileRef.current?.click(), enabled: () => editable() && !importing },
    { id: 'timeline.add-audio-track', group: 'Timeline', label: 'Add audio track', run: () => addTrack(null), enabled: editable },
    { id: 'timeline.add-instrument-track', group: 'Timeline', label: `Add instrument track (${INSTRUMENT_LABELS[newInstrument]})`, run: () => addTrack(newInstrument), enabled: editable },
    { id: 'timeline.split', group: 'Clip', label: 'Split at edit cursor', keys: 'Mod+E', global: true, run: () => commands.split(view.selectedTrackId), enabled: () => editable() && hasClips },
    { id: 'timeline.join', group: 'Clip', label: 'Join clips', keys: 'Mod+J', global: true, run: () => commands.join(), enabled: () => editable() && hasClips },
    { id: 'timeline.duplicate', group: 'Clip', label: 'Duplicate clip', keys: 'Mod+D', global: true, run: () => commands.duplicate(), enabled: () => editable() && selection.length > 0 },
    { id: 'timeline.delete', group: 'Clip', label: 'Delete clip', keys: 'Delete', run: () => commands.remove(), enabled: () => editable() && selection.length > 0 },
    { id: 'timeline.select-all', group: 'Clip', label: 'Select all clips', keys: 'Mod+A', run: () => setSelection(Object.keys(project.clips)), enabled: () => hasClips },
    { id: 'timeline.focus', group: 'Go to', label: 'Tracks and clips', run: focusTree },
    {
      id: 'timeline.delete-track',
      group: 'Timeline',
      label: project.tracks[view.selectedTrackId] ? `Delete track ${project.tracks[view.selectedTrackId].name}` : 'Delete track',
      run: () => deleteTrack(view.selectedTrackId),
      enabled: () => editable() && Boolean(project.tracks[view.selectedTrackId]),
    },
    { id: 'timeline.snap', group: 'Timeline', label: view.snapOn ? 'Turn snap off' : 'Turn snap on', keys: 'G', global: true, run: () => setSnap({ snapOn: !view.snapOn }) },
    { id: 'timeline.grid-finer', group: 'Timeline', label: 'Finer grid', keys: '+', global: true, run: () => setSnap({ snap: stepGrid(view.snap, 1) }), enabled: () => view.snap !== stepGrid(view.snap, 1) },
    { id: 'timeline.grid-coarser', group: 'Timeline', label: 'Coarser grid', keys: '-', global: true, run: () => setSnap({ snap: stepGrid(view.snap, -1) }), enabled: () => view.snap !== stepGrid(view.snap, -1) },
  ]);

  /** Changes the snap grid or toggle (ARR-04) and announces the result: "Snap: 1/16", "Snap off". */
  function setSnap(changes) {
    const next = { snap: view.snap, snapOn: view.snapOn, ...changes };
    onViewChange(changes);
    announce(next.snapOn ? `Snap: ${SNAP_OPTIONS.find((o) => o.value === next.snap).label}` : 'Snap off');
  }

  function setCursor(tick, say = true) {
    const t = Math.max(0, tick);
    engine.locate(t);
    onViewChange({ playhead: t });
    if (say) announce(`Edit cursor ${barText(t, meter)}`);
  }

  function stepCursor(sign, unit) {
    const step = unit === 'bar' ? barTicks : stepTicks;
    setCursor(Math.round(editCursor / step) * step + sign * step);
  }

  async function importAudio(files) {
    if (files.length === 0) return;
    setImporting(true);
    const lines = [];
    const selected = project.tracks[view.selectedTrackId];
    let trackId = selected?.kind === 'audio' ? selected.id : null;
    let tick = editCursor;
    try {
      await importFiles(files, {
        rate: engine.decodeRate(),
        projectSources: commands.docRef.current.sources,
        onResult(result) {
          if (!result.ok) {
            lines.push(result.message);
          } else {
            const name = result.source.name;
            const added = addAudioClip(commands.docRef.current, { trackId, tick, source: result.source });
            if (!added.ok) lines.push(`${name} was not added. ${added.error.message}`);
            else {
              trackId = added.trackId;
              tick = clipEndTick(added.doc, added.doc.clips[added.clipId]);
              commands.commit(added.doc);
              lines.push(result.message ? `Added ${name}. Session only. ${result.message}` : `Added ${name}. Saved on this device.`);
            }
          }
          setResults([...lines]);
        },
      });
    } finally {
      setImporting(false);
    }
  }

  /**
   * Adds an audio track, or an instrument track of `type` with a four-bar MIDI
   * clip open in the piano roll and focus on its first cell (ONB-02).
   */
  function addTrack(type) {
    if (!type) {
      const added = addAudioTrack(commands.docRef.current);
      if (!added.ok) return announce(added.error.message);
      commands.commit(added.doc, `Added ${added.doc.tracks[added.trackId].name}`);
      onViewChange({ selectedTrackId: added.trackId });
      return;
    }
    const added = addInstrumentTrack(commands.docRef.current, type);
    if (!added.ok) return announce(added.error.message);
    const clip = createClip(added.doc, added.trackId);
    const doc = clip.ok ? clip.doc : added.doc;
    commands.commit(doc, clip.ok ? `${INSTRUMENT_LABELS[type]} track added, clip open in piano roll` : `Added ${doc.tracks[added.trackId].name}`);
    onViewChange({
      selectedTrackId: added.trackId,
      selectedClipIds: clip.ok ? [clip.clipId] : [],
      panelClipId: clip.ok ? clip.clipId : null,
      openPanel: 'pianoroll',
      dock: 'editor',
    });
    setTimeout(() => document.querySelector('[role="grid"][aria-label="Notes"] [tabindex="0"]')?.focus(), 50);
  }

  /** Deletes track `trackId`; one with clips asks first, since deletion cannot be undone. */
  function deleteTrack(trackId, confirmed = false) {
    const track = commands.docRef.current.tracks[trackId];
    if (!track) return;
    if (track.clipIds.length > 0 && !confirmed) {
      setDoomedTrackId(trackId);
      return;
    }
    setDoomedTrackId(null);
    const removed = removeTrack(commands.docRef.current, trackId);
    if (!removed.ok) return announce(removed.error.message);
    const i = rowIds.indexOf(trackId);
    const nextId = rowIds[i + 1] ?? rowIds[i - 1] ?? null;
    commands.commit(removed.doc, `Deleted ${track.name}`);
    onViewChange({ selectedTrackId: nextId, selectedClipIds: selection.filter((id) => removed.doc.clips[id]) });
    setTimeout(() => (nextId ? focusTree() : document.querySelector('section[aria-label="No tracks"] button')?.focus()), 50);
  }

  /** Opens the clip menu for `clip` at viewport point x, y; focus returns to `returnFocus`. */
  function openMenu(clip, x, y, returnFocus) {
    if (!selection.includes(clip.id)) setSelection([clip.id]);
    setMenu({ clipId: clip.id, x, y, returnFocus });
  }

  function menuItems(clip) {
    const inside = clip.start < editCursor && editCursor < clipEndTick(project, clip);
    const join = commands.joinPair(project);
    return [
      { label: 'Split at edit cursor', note: inside ? null : 'The edit cursor is outside this clip.', run: () => commands.split(null) },
      { label: 'Join clips', note: join.reason, run: () => commands.join() },
      { label: 'Duplicate clip', run: () => commands.duplicate() },
      {
        label: clip.muted ? 'Unmute clip' : 'Mute clip',
        run: () => {
          const latest = commands.docRef.current.clips[clip.id];
          commands.commit({ ...commands.docRef.current, clips: { ...commands.docRef.current.clips, [clip.id]: { ...latest, muted: !latest.muted } } }, `${latest.name} ${latest.muted ? 'unmuted' : 'muted'}`);
        },
      },
      { label: 'Rename clip…', run: () => onOpenProperties('name') },
      { label: 'Delete clip', run: () => commands.remove([clip.id]) },
    ];
  }

  const clipRow = (id) => document.querySelector(`[role="treegrid"] [data-clip-id="${id}"]`);

  function onContextMenu(e) {
    if (!onTimeline(e)) return;
    const { x, row } = pointerPosition(e);
    const trackId = rowIds[row];
    const hit = trackId ? clipAt(project, project.tracks[trackId], xToTick(x, view.zoom)) : null;
    if (!hit) return;
    e.preventDefault();
    openMenu(hit, e.clientX, e.clientY, clipRow(hit.id));
  }

  /** Content coordinates of a pointer event: x along the timeline (scroll included), y from the ruler's top. */
  function pointerPosition(e) {
    const c = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - c.top;
    return { x: e.clientX - c.left + scrollRef.current.scrollLeft, y, row: Math.floor((y - RULER_H) / TRACK_H), inside: e.clientX >= c.left };
  }

  /** Events from the track headers, or left of the canvas, are not timeline edits. */
  const onTimeline = (e) => !e.target.closest?.('[data-track-header]') && pointerPosition(e).inside;

  // Track headers and the canvas stay put while the arrangement scrolls; the position is saved with the view.
  function onScroll(e) {
    const el = e.currentTarget;
    contentRef.current?.style.setProperty('--sx', `${el.scrollLeft}px`);
    clearTimeout(scrollSave.current);
    scrollSave.current = setTimeout(() => onViewChange({ scrollX: el.scrollLeft, scrollY: el.scrollTop }), 250);
  }
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    el.scrollLeft = view.scrollX;
    el.scrollTop = view.scrollY;
    contentRef.current?.style.setProperty('--sx', `${el.scrollLeft}px`);
    return () => clearTimeout(scrollSave.current);
    // Restored once, when the project opens (RET-02).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onTrackChange(trackId, changes) {
    const doc = commands.docRef.current;
    const t = doc.tracks[trackId];
    const said = 'mute' in changes ? `${t.name} ${changes.mute ? 'muted' : 'unmuted'}` : `${t.name} ${changes.solo ? 'soloed' : 'unsoloed'}`;
    commands.commit(setTrack(doc, trackId, changes), said);
  }

  /** The clip under a pointer position, with its row and box, or null. */
  function hitAt({ x, row }) {
    const trackId = rowIds[row];
    const clip = trackId ? clipAt(project, project.tracks[trackId], xToTick(x, view.zoom)) : null;
    return clip ? { clip, row, rect: clipRect(project, clip, row, view.zoom) } : null;
  }

  function onPointerDown(e) {
    if (e.button !== 0 || readOnly || !onTimeline(e)) return;
    const pos = pointerPosition(e);
    const { x, y, row } = pos;
    const mod = e.ctrlKey || e.metaKey;
    const hit = hitAt(pos);
    if (!hit) {
      // Empty space: a drag draws a marquee; a click moves the edit cursor (on release).
      drag.current = { mode: 'marquee', x0: x, y0: y, additive: e.shiftKey || mod, altKey: e.altKey };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const clip = hit.clip;
    if (clip.kind === 'audio' && selection.includes(clip.id) && !mod && !e.shiftKey) {
      const handle = handleAt(project, clip, hit.rect, x, y, view.zoom);
      if (handle) {
        drag.current = { mode: handle, clipId: clip.id, rect: hit.rect, x0: x, y0: y };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      const point = envelopePointAt(project, clip, hit.rect, x, y, view.zoom);
      if (point) {
        drag.current = { mode: 'envPoint', clipId: clip.id, pointId: point.id, rect: hit.rect, x0: x, y0: y };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    const { x0: left, x1: right } = hit.rect;
    const mode = x - left <= EDGE_PX ? 'trimStart' : right - x <= EDGE_PX ? 'trimEnd' : 'move';
    let next = selection;
    if (mod) next = selection.includes(clip.id) ? selection.filter((id) => id !== clip.id) : [...selection, clip.id];
    else if (e.shiftKey && selection.length > 0 && project.clips[selection[0]]?.trackId === clip.trackId) {
      const anchor = project.clips[selection[0]];
      const [a, b] = [Math.min(anchor.start, clip.start), Math.max(anchor.start, clip.start)];
      next = project.tracks[clip.trackId].clipIds.filter((id) => project.clips[id].start >= a && project.clips[id].start <= b);
    } else if (!selection.includes(clip.id) || mode !== 'move') next = [clip.id];
    setSelection(next);
    if (!next.includes(clip.id)) return;
    drag.current = { mode, x0: x, row0: row, clipIds: mode === 'move' ? next : [clip.id] };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const { x, y, row } = pointerPosition(e);
    const clip = d.clipId ? project.clips[d.clipId] : null;
    if (d.mode === 'marquee') {
      if (Math.abs(x - d.x0) < 4 && Math.abs(y - d.y0) < 4) return;
      setGhost({ mode: 'marquee', x0: d.x0, y0: d.y0, x1: x, y1: y });
    } else if (d.mode === 'fadeIn' || d.mode === 'fadeOut') {
      const f = frameAtX(project, clip, x, view.zoom);
      const other = d.mode === 'fadeIn' ? clip.fadeOut.length : clip.fadeIn.length;
      const raw = d.mode === 'fadeIn' ? f : clip.sourceLength - f;
      setGhost({ mode: d.mode, clipId: clip.id, length: Math.max(0, Math.min(clip.sourceLength - other, raw)) });
    } else if (d.mode === 'gain') {
      const db = Math.round(Math.max(CLIP_GAIN_MIN_DB, Math.min(CLIP_GAIN_MAX_DB, clip.gainDb - (y - d.y0) * GAIN_DB_PER_PX)) * 10) / 10;
      setGhost({ mode: 'gain', clipId: clip.id, gainDb: db });
    } else if (d.mode === 'envPoint') {
      setGhost({ mode: 'envPoint', clipId: clip.id, pointId: d.pointId, frame: frameAtX(project, clip, x, view.zoom), gain: gainAtY(d.rect, y) });
    } else {
      const raw = Math.round((x - d.x0) / pxPerTick(view.zoom));
      // Alt while dragging bypasses snap (ARR-04).
      const dTick = snapTick(raw, e.altKey);
      setGhost({ clipIds: d.clipIds, mode: d.mode, dTick, dRow: d.mode === 'move' ? row - d.row0 : 0 });
    }
  }

  /** Clips whose box meets the marquee rectangle. */
  function clipsInMarquee(g) {
    const [xa, xb] = [Math.min(g.x0, g.x1), Math.max(g.x0, g.x1)];
    const [ya, yb] = [Math.min(g.y0, g.y1), Math.max(g.y0, g.y1)];
    const ids = [];
    rowIds.forEach((trackId, row) => {
      for (const clip of trackClips(project, project.tracks[trackId])) {
        const r = clipRect(project, clip, row, view.zoom);
        if (r.x1 >= xa && r.x0 <= xb && r.top + r.height >= ya && r.top <= yb) ids.push(clip.id);
      }
    });
    return ids;
  }

  function onPointerUp(e) {
    const d = drag.current;
    const g = ghostRef.current;
    drag.current = null;
    setGhost(null);
    if (!d) return;
    const clip = d.clipId ? commands.docRef.current.clips[d.clipId] : null;
    if (d.mode === 'marquee') {
      if (!g) {
        const t = xToTick(pointerPosition(e).x, view.zoom);
        setSelection([]);
        setCursor(snapTick(t, d.altKey));
        return;
      }
      const found = clipsInMarquee(g);
      const next = d.additive ? [...new Set([...selection, ...found])] : found;
      setSelection(next);
      announce(next.length === 1 ? '1 clip selected' : `${next.length} clips selected`);
      return;
    }
    if (!g || !clip) return;
    const doc = commands.docRef.current;
    if (d.mode === 'fadeIn' || d.mode === 'fadeOut') {
      const which = d.mode;
      const result = setFade(doc, clip.id, which, g.length, clip[which].curve);
      if (result.ok) commands.commit(result.doc, `${which === 'fadeIn' ? 'Fade-in' : 'Fade-out'} ${Math.round((g.length / (doc.audioRate ?? 48000)) * 1000)} ms`);
    } else if (d.mode === 'gain') {
      const result = setClipGain(doc, clip.id, g.gainDb);
      if (result.ok) commands.commit(result.doc, `Clip gain ${faderText(g.gainDb)}`);
    } else if (d.mode === 'envPoint') {
      const result = setEnvelopePoint(doc, clip.id, g.pointId, g.frame, g.gain);
      if (result.ok) commands.commit(result.doc, `Envelope point ${faderText(gainDb(g.gain))}`);
    } else if (g.dTick !== 0 || g.dRow !== 0) {
      if (d.mode === 'move') {
        if (g.dRow !== 0) commands.moveToRow(g.dTick, d.row0 + g.dRow);
        else commands.move(g.dTick);
      } else commands.trim(d.mode === 'trimStart' ? 'start' : 'end', 0, g.dTick);
    }
  }

  /** Double-click on a selected audio clip adds an envelope point there; on a point, removes it (ARR-05). */
  function onDoubleClick(e) {
    if (readOnly || !onTimeline(e)) return;
    const pos = pointerPosition(e);
    const hit = hitAt(pos);
    if (!hit || hit.clip.kind !== 'audio' || !selection.includes(hit.clip.id)) return;
    const doc = commands.docRef.current;
    const point = envelopePointAt(doc, hit.clip, hit.rect, pos.x, pos.y, view.zoom);
    if (point) {
      const result = removeEnvelopePoint(doc, hit.clip.id, point.id);
      if (result.ok) commands.commit(result.doc, 'Envelope point removed');
      return;
    }
    const gain = gainAtY(hit.rect, pos.y);
    const result = addEnvelopePoint(doc, hit.clip.id, frameAtX(doc, hit.clip, pos.x, view.zoom), gain);
    if (result.ok) commands.commit(result.doc, `Envelope point added at ${faderText(gainDb(gain))}`);
  }

  const width = tickToX(Math.max(contentEnd(project), editCursor) + TAIL_BARS * barTicks, view.zoom);

  const contentHeight = RULER_H + Math.max(1, rowIds.length) * TRACK_H;
  const small = 'min-h-7 px-2 text-xs';

  return (
    <section aria-labelledby="studio-timeline" className="flex min-h-0 flex-1 flex-col">
      <h2 id="studio-timeline" className="sr-only">
        Timeline
      </h2>
      <Toolbar label="Clip commands" className="flex items-center gap-2 overflow-x-auto border-b border-border bg-surface px-3 py-1 [&>*]:shrink-0">
        <Select
          id="timeline-new-instrument"
          label="Instrument"
          labelClassName="w-auto"
          className="w-auto shrink-0"
          value={newInstrument}
          options={INSTRUMENT_OPTIONS}
          disabled={readOnly}
          onChange={setNewInstrument}
        />
        <Button size="sm" onClick={() => addTrack(newInstrument)} disabled={readOnly} data-help="Adds a track playing the chosen instrument.">
          Add instrument track
        </Button>
        <Button size="sm" onClick={() => addTrack(null)} disabled={readOnly} data-help="Adds an empty audio track for audio clips.">
          Add audio track
        </Button>
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={readOnly || importing} data-help="Adds WAV, MP3, M4A, FLAC or OGG files as clips at the edit cursor.">
          {importing ? 'Adding audio…' : 'Add audio file'}
        </Button>
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
        <Toggle size="sm" pressed={view.snapOn} onClick={() => setSnap({ snapOn: !view.snapOn })} data-help="Snap (G): drags land on the grid; hold Alt while dragging to place freely.">
          Snap
        </Toggle>
        <Select
          id="timeline-snap"
          label="Grid"
          labelClassName="w-auto"
          className="w-auto shrink-0"
          value={view.snap}
          options={SNAP_OPTIONS}
          onChange={(v) => setSnap({ snap: v })}
          data-help="Grid (+ and −): the snap step for drags and keyboard nudges."
        />
        <Button size="sm" onClick={() => onViewChange({ zoom: stepZoom(view.zoom, -1) })} disabled={view.zoom <= ZOOM_MIN} data-help="Zoom out (Alt+−).">
          Zoom out
        </Button>
        <output aria-live="polite" className="w-20 shrink-0 text-center text-xs tabular-nums">
          Zoom {Math.round(view.zoom * 100)}%
        </output>
        <Button size="sm" onClick={() => onViewChange({ zoom: stepZoom(view.zoom, 1) })} disabled={view.zoom >= ZOOM_MAX} data-help="Zoom in (Alt+=).">
          Zoom in
        </Button>
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
        <Button size="sm" onClick={() => commands.split(view.selectedTrackId)} disabled={readOnly || !hasClips} data-help="Split (Ctrl/Cmd+E): cuts the selected clips at the edit cursor.">
          Split at edit cursor
        </Button>
        <Button
          size="sm"
          onClick={commands.join}
          disabled={readOnly || !hasClips}
          aria-describedby={showJoin && joinState.reason ? 'timeline-join-reason' : undefined}
          data-help="Join (Ctrl/Cmd+J): joins touching clips of one recording."
        >
          Join clips
        </Button>
        <Button size="sm" onClick={commands.duplicate} disabled={readOnly || selection.length === 0} data-help="Duplicate (Ctrl/Cmd+D): copies the selected clips after themselves.">
          Duplicate clip
        </Button>
        <Button size="sm" onClick={commands.remove} disabled={readOnly || selection.length === 0} data-help="Delete: removes the selected clips.">
          Delete clip
        </Button>
        <p className={cx(small, 'shrink-0 whitespace-nowrap')}>Edit cursor: {barText(editCursor, meter)}</p>
      </Toolbar>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          importAudio(files);
        }}
      />
      {showJoin || results.length > 0 ? (
        <div className="flex flex-wrap items-start gap-x-4 border-b border-border bg-surface-2 px-3 py-1 text-xs">
          {showJoin ? (
            <p id="timeline-join-reason" className="text-muted">
              {joinState.reason ? `Join: ${joinState.reason}` : 'Join: the selected clips can be joined.'}
            </p>
          ) : null}
        </div>
      ) : null}
      <StatusRegion aria-label="Import results" className="px-3 text-xs">
        {results.length > 0 ? (
          <ul className="flex flex-col py-1">
            {results.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
      </StatusRegion>
      <StatusRegion visuallyHidden>{announcement}</StatusRegion>
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto bg-surface"
        style={{ touchAction: 'pan-y' }}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setGhost(null);
        }}
      >
        <div ref={contentRef} className="relative" style={{ width: HEADER_W + width, height: contentHeight }}>
          {rowIds.length === 0 ? (
            <section
              aria-label="No tracks"
              className="absolute inset-x-0 z-10 flex items-center gap-3 px-4 py-6"
              style={{ top: RULER_H, transform: 'translateX(var(--sx, 0px))' }}
            >
              <p className="text-sm">No tracks.</p>
              <Button size="sm" variant="primary" onClick={() => addTrack(newInstrument)} disabled={readOnly}>
                Add instrument track
              </Button>
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={readOnly || importing}>
                Add audio file
              </Button>
            </section>
          ) : null}
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 z-20 flex items-center border-r border-b border-border-strong bg-surface-2 px-2 text-xs font-bold text-muted uppercase"
            style={{ width: HEADER_W, height: RULER_H, transform: 'translateX(var(--sx, 0px))' }}
          >
            Tracks
          </div>
          <TimelineCanvas
            canvasRef={canvasRef}
            project={project}
            rowIds={rowIds}
            zoom={view.zoom}
            meter={meter}
            selected={new Set(selection)}
            ghost={ghost}
            editCursor={editCursor}
            scrollRef={scrollRef}
          />
          <TimelineTree
            project={project}
            rowIds={rowIds}
            meter={meter}
            zoom={view.zoom}
            selection={selection}
            setSelection={setSelection}
            selectedTrackId={view.selectedTrackId}
            onSelectTrack={(id) => onViewChange({ selectedTrackId: id })}
            onDeleteTrack={(id) => deleteTrack(id)}
            onTrackChange={onTrackChange}
            statusFor={statusFor}
            commands={commands}
            editCursor={editCursor}
            onCursorStep={stepCursor}
            onOpenProperties={() => onOpenProperties('name')}
            readOnly={readOnly}
            onClipMenu={(clip, el) => {
              const r = el.getBoundingClientRect();
              openMenu(clip, r.left + 24, r.bottom, el);
            }}
          />
        </div>
      </div>
      {menu && project.clips[menu.clipId] ? (
        <ClipMenu
          label={`Clip actions: ${project.clips[menu.clipId].name}`}
          x={menu.x}
          y={menu.y}
          items={menuItems(project.clips[menu.clipId])}
          returnFocus={menu.returnFocus}
          onClose={() => setMenu(null)}
        />
      ) : null}
      <Dialog
        open={Boolean(project.tracks[doomedTrackId])}
        onClose={() => setDoomedTrackId(null)}
        title={project.tracks[doomedTrackId] ? `Delete ${project.tracks[doomedTrackId].name}?` : 'Delete track?'}
        initialFocusRef={cancelDeleteRef}
        actions={
          <>
            <Button ref={cancelDeleteRef} onClick={() => setDoomedTrackId(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => deleteTrack(doomedTrackId, true)}>
              Delete track
            </Button>
          </>
        }
      >
        <p>
          The track, its {project.tracks[doomedTrackId]?.clipIds.length === 1 ? 'clip' : `${project.tracks[doomedTrackId]?.clipIds.length ?? 0} clips`} and its devices are removed. This cannot be undone.
        </p>
      </Dialog>
    </section>
  );
}
