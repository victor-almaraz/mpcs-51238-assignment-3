'use client';

import { useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import Toolbar from '@/components/ui/Toolbar';
import useThrottledAnnouncer from '@/components/ui/useThrottledAnnouncer';
import useCommands from '@/components/commands/useCommands';
import { sectionHeading } from '@/design-systems/industrial/classes';
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
  setClipGain,
  setEnvelopePoint,
  setFade,
} from '@/lib/project/clip-commands';
import { INSTRUMENT_LABELS, ticksPerBar } from '@/lib/project/model';
import ClipMenu from './ClipMenu';
import ClipProperties from './ClipProperties';
import TimelineCanvas from './TimelineCanvas';
import TimelineTree from './TimelineTree';
import useTimelineCommands from './useTimelineCommands';
import {
  EDGE_PX,
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
/** Snap steps in quarter notes (ARR-04); 'bar' snaps to the bar. */
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
export default function Timeline({ project, view, onViewChange, onEdit, readOnly, loading }) {
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
  const [snap, setSnap] = useState('1');
  const [menu, setMenu] = useState(null); // { clipId, x, y, returnFocus }
  const stepTicks = snap === 'bar' ? barTicks : Number(snap) * PPQ;
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const nameRef = useRef(null);
  const drag = useRef(null);

  const setSelection = (ids) => onViewChange({ selectedClipIds: ids });
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
  const primary = project.clips[selection[selection.length - 1]] ?? null;
  const joinState = commands.joinPair(project);
  const hasClips = Object.keys(project.clips).length > 0;
  const showJoin = selection.length > 0;
  const focusTree = () => document.querySelector('[role="treegrid"][aria-label="Tracks and clips"] [role="row"][tabindex="0"]')?.focus();
  const editable = () => !readOnly;
  useCommands([
    { id: 'timeline.add-audio', group: 'Timeline', label: 'Add audio file…', run: () => fileRef.current?.click(), enabled: () => editable() && !importing },
    { id: 'timeline.add-audio-track', group: 'Timeline', label: 'Add audio track', run: () => addTrack(null), enabled: editable },
    { id: 'timeline.add-instrument-track', group: 'Timeline', label: `Add instrument track (${INSTRUMENT_LABELS[newInstrument]})`, run: () => addTrack(newInstrument), enabled: editable },
    { id: 'timeline.split', group: 'Clip', label: 'Split at edit cursor', keys: 'Mod+E', run: () => commands.split(view.selectedTrackId), enabled: () => editable() && hasClips },
    { id: 'timeline.join', group: 'Clip', label: 'Join clips', keys: 'Mod+J', run: () => commands.join(), enabled: () => editable() && hasClips },
    { id: 'timeline.duplicate', group: 'Clip', label: 'Duplicate clip', keys: 'Mod+D', run: () => commands.duplicate(), enabled: () => editable() && selection.length > 0 },
    { id: 'timeline.delete', group: 'Clip', label: 'Delete clip', keys: 'Delete', run: () => commands.remove(), enabled: () => editable() && selection.length > 0 },
    { id: 'timeline.select-all', group: 'Clip', label: 'Select all clips', keys: 'Mod+A', run: () => setSelection(Object.keys(project.clips)), enabled: () => hasClips },
    { id: 'timeline.focus', group: 'Go to', label: 'Tracks and clips', run: focusTree },
  ]);

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

  function addTrack(type) {
    const added = type ? addInstrumentTrack(commands.docRef.current, type) : addAudioTrack(commands.docRef.current);
    if (!added.ok) {
      announce(added.error.message);
      return;
    }
    commands.commit(added.doc, `Added ${added.doc.tracks[added.trackId].name}`);
    onViewChange({ selectedTrackId: added.trackId });
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
      { label: 'Rename clip…', run: () => setTimeout(() => document.getElementById(`clip-${clip.id}-name`)?.focus(), 0) },
      { label: 'Delete clip', run: () => commands.remove([clip.id]) },
    ];
  }

  const clipRow = (id) => document.querySelector(`[role="treegrid"] [data-clip-id="${id}"]`);

  function onContextMenu(e) {
    const { x, row } = pointerPosition(e);
    const trackId = rowIds[row];
    const hit = trackId ? clipAt(project, project.tracks[trackId], xToTick(x, view.zoom)) : null;
    if (!hit) return;
    e.preventDefault();
    openMenu(hit, e.clientX, e.clientY, clipRow(hit.id));
  }

  function pointerPosition(e) {
    const el = scrollRef.current;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top + el.scrollTop;
    return { x: e.clientX - rect.left + el.scrollLeft, y, row: Math.floor((y - RULER_H) / TRACK_H) };
  }

  /** The clip under a pointer position, with its row and box, or null. */
  function hitAt({ x, row }) {
    const trackId = rowIds[row];
    const clip = trackId ? clipAt(project, project.tracks[trackId], xToTick(x, view.zoom)) : null;
    return clip ? { clip, row, rect: clipRect(project, clip, row, view.zoom) } : null;
  }

  function onPointerDown(e) {
    if (e.button !== 0 || readOnly) return;
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
      const dTick = e.altKey ? raw : Math.round(raw / stepTicks) * stepTicks;
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
        setCursor(d.altKey ? t : Math.round(t / stepTicks) * stepTicks);
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
    if (readOnly) return;
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

  return (
    <section aria-labelledby="studio-timeline" className="flex flex-col gap-2">
      <h2 id="studio-timeline" className={sectionHeading}>
        Timeline
      </h2>
      <Toolbar label="Clip commands" className="flex flex-wrap items-center gap-2">
        <Button onClick={() => fileRef.current?.click()} disabled={readOnly || importing}>
          {importing ? 'Adding audio…' : 'Add audio file'}
        </Button>
        <Button onClick={() => addTrack(null)} disabled={readOnly}>
          Add audio track
        </Button>
        <Select
          id="timeline-new-instrument"
          label="Instrument"
          value={newInstrument}
          options={INSTRUMENT_OPTIONS}
          disabled={readOnly}
          onChange={setNewInstrument}
        />
        <Button onClick={() => addTrack(newInstrument)} disabled={readOnly}>
          Add instrument track
        </Button>
        <Select id="timeline-snap" label="Snap" value={snap} options={SNAP_OPTIONS} onChange={(v) => {
          setSnap(v);
          announce(`Snap: ${SNAP_OPTIONS.find((o) => o.value === v).label}`);
        }} />
        <Button onClick={() => commands.split(view.selectedTrackId)} disabled={readOnly || !hasClips}>
          Split at edit cursor
        </Button>
        <Button onClick={commands.join} disabled={readOnly || !hasClips} aria-describedby={showJoin && joinState.reason ? 'timeline-join-reason' : undefined}>
          Join clips
        </Button>
        <Button onClick={commands.duplicate} disabled={readOnly || selection.length === 0}>
          Duplicate clip
        </Button>
        <Button onClick={commands.remove} disabled={readOnly || selection.length === 0}>
          Delete clip
        </Button>
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
      {showJoin ? (
        <p id="timeline-join-reason" className="text-sm text-muted">
          {joinState.reason ? `Join: ${joinState.reason}` : 'Join: the selected clips can be joined.'}
        </p>
      ) : null}
      <p className="text-sm">Edit cursor: {barText(editCursor, meter)}</p>
      <StatusRegion aria-label="Import results" className="text-sm">
        {results.length > 0 ? (
          <ul>
            {results.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
      </StatusRegion>
      <StatusRegion visuallyHidden>{announcement}</StatusRegion>
      <div
        ref={scrollRef}
        className="relative overflow-x-auto overflow-y-hidden rounded-ds border border-border-strong"
        style={{ height: RULER_H + Math.max(1, rowIds.length) * TRACK_H + 16, touchAction: 'pan-y' }}
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
        <TimelineCanvas
          project={project}
          rowIds={rowIds}
          zoom={view.zoom}
          meter={meter}
          selected={new Set(selection)}
          ghost={ghost}
          editCursor={editCursor}
          scrollRef={scrollRef}
        />
        <div aria-hidden="true" style={{ width, height: 1 }} />
      </div>
      <TimelineTree
        project={project}
        rowIds={rowIds}
        meter={meter}
        selection={selection}
        setSelection={setSelection}
        statusFor={statusFor}
        commands={commands}
        editCursor={editCursor}
        onCursorStep={stepCursor}
        onOpenProperties={() => nameRef.current?.focus()}
        onClipMenu={(clip, el) => {
          const r = el.getBoundingClientRect();
          openMenu(clip, r.left + 24, r.bottom, el);
        }}
      />
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
      {primary ? (
        <ClipProperties
          key={primary.id}
          project={project}
          clip={primary}
          status={statusFor(primary)}
          editCursor={editCursor}
          onEdit={(next) => commands.commit(next)}
          readOnly={readOnly}
          nameRef={nameRef}
        />
      ) : null}
    </section>
  );
}
