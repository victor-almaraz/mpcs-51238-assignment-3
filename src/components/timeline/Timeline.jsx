'use client';

import { useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import Toolbar from '@/components/ui/Toolbar';
import useThrottledAnnouncer from '@/components/ui/useThrottledAnnouncer';
import { sectionHeading } from '@/design-systems/industrial/classes';
import { PPQ } from '@/dsp/core/constants';
import { MeterMap } from '@/dsp/timing/meter-map';
import { getSource, importFiles } from '@/lib/audio/decode';
import { getEngine } from '@/lib/audio/engine-client';
import { addAudioClip, addAudioTrack, addInstrumentTrack, clipEndTick } from '@/lib/project/clip-commands';
import { INSTRUMENT_LABELS, ticksPerBar } from '@/lib/project/model';
import ClipProperties from './ClipProperties';
import TimelineCanvas from './TimelineCanvas';
import TimelineTree from './TimelineTree';
import useTimelineCommands from './useTimelineCommands';
import { EDGE_PX, TAIL_BARS, TRACK_H, barText, clipAt, contentEnd, pxPerTick, sourceStatus, tickToX, xToTick } from './layout';

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
  const [ghost, setGhost] = useState(null);
  const [newInstrument, setNewInstrument] = useState('subtractive');
  const [snap, setSnap] = useState('1');
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

  function pointerPosition(e) {
    const el = scrollRef.current;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left + el.scrollLeft, row: Math.floor((e.clientY - rect.top + el.scrollTop) / TRACK_H) };
  }

  function onPointerDown(e) {
    if (e.button !== 0 || readOnly) return;
    const { x, row } = pointerPosition(e);
    const trackId = rowIds[row];
    const hit = trackId ? clipAt(project, project.tracks[trackId], xToTick(x, view.zoom)) : null;
    if (!hit) {
      setSelection([]);
      const t = xToTick(x, view.zoom);
      setCursor(e.altKey ? t : Math.round(t / stepTicks) * stepTicks);
      return;
    }
    const left = tickToX(hit.start, view.zoom);
    const right = tickToX(clipEndTick(project, hit), view.zoom);
    const mode = x - left <= EDGE_PX ? 'trimStart' : right - x <= EDGE_PX ? 'trimEnd' : 'move';
    let next = selection;
    if (e.ctrlKey || e.metaKey) next = selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id];
    else if (e.shiftKey && selection.length > 0 && project.clips[selection[0]]?.trackId === hit.trackId) {
      const anchor = project.clips[selection[0]];
      const [a, b] = [Math.min(anchor.start, hit.start), Math.max(anchor.start, hit.start)];
      next = project.tracks[hit.trackId].clipIds.filter((id) => project.clips[id].start >= a && project.clips[id].start <= b);
    } else if (!selection.includes(hit.id) || mode !== 'move') next = [hit.id];
    setSelection(next);
    if (!next.includes(hit.id)) return;
    drag.current = { mode, x0: x, row0: row, clipIds: mode === 'move' ? next : [hit.id] };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    const { x, row } = pointerPosition(e);
    const raw = Math.round((x - d.x0) / pxPerTick(view.zoom));
    // Alt while dragging bypasses snap (ARR-04).
    const dTick = e.altKey ? raw : Math.round(raw / stepTicks) * stepTicks;
    setGhost({ clipIds: d.clipIds, mode: d.mode, dTick, dRow: d.mode === 'move' ? row - d.row0 : 0 });
  }

  function onPointerUp() {
    const d = drag.current;
    const g = ghost;
    drag.current = null;
    setGhost(null);
    if (!d || !g || (g.dTick === 0 && g.dRow === 0)) return;
    if (d.mode === 'move') {
      if (g.dRow !== 0) commands.moveToRow(g.dTick, d.row0 + g.dRow);
      else commands.move(g.dTick);
    } else commands.trim(d.mode === 'trimStart' ? 'start' : 'end', 0, g.dTick);
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
        <Button onClick={() => commands.split(view.selectedTrackId)} disabled={readOnly}>
          Split at edit cursor
        </Button>
        <Button onClick={commands.join} disabled={readOnly} aria-describedby={joinState.reason ? 'timeline-join-reason' : undefined}>
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
      <p id="timeline-join-reason" className="text-sm text-muted">
        {joinState.reason ? `Join: ${joinState.reason}` : 'Join: the selected clips can be joined.'}
      </p>
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
        style={{ height: Math.max(1, rowIds.length) * TRACK_H + 16, touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
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
      />
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
