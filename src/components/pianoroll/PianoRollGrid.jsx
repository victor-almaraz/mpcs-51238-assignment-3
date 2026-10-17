'use client';

import { focusRing, groupHeading, sectionHeading, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import Toolbar from '@/components/ui/Toolbar';
import useThrottledAnnouncer from '@/components/ui/useThrottledAnnouncer';
import { cx } from '@/design-systems/industrial/classes';
import { PPQ } from '@/dsp/core/constants';
import { MeterMap } from '@/dsp/timing/meter-map';
import { getEngine } from '@/lib/audio/engine-client';
import { noteAt, notesStartingIn } from '@/lib/project/midi-commands';
import { ticksPerBar } from '@/lib/project/model';
import PianoRollCanvas from './PianoRollCanvas';
import { CELL_W, DEFAULT_GRID, GRIDS, LABEL_W, ROW_H, inChokeGroup, noteText, positionText, rowLabel, rowPitches, rowShortLabel } from './layout';
import usePianoRollCommands from './usePianoRollCommands';
import VelocityLane from './VelocityLane';
import IconButton from '@/components/ui/IconButton';
import IconToggle from '@/components/ui/IconToggle';

/** Initial viewport height before the scroller is measured. */
const VIEW_HEIGHT = 480;
const PIANO_ROLL_HELP =
  'Arrow keys move. Enter adds or removes a note; Delete removes it. Alt+arrows move it; Shift+Left and Right change its length; Shift+Up and Down change its velocity. Q quantizes.';
const GRID_OPTIONS = GRIDS.map((g) => ({ value: String(g.value), label: g.label }));
const LOOP_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: '1', label: '1 bar' },
  { value: '2', label: '2 bars' },
  { value: '4', label: '4 bars' },
];
/** Cursor tick that marks the row header. */
const HEADER = -1;
/** Smallest note-grid height: three rows and the border; below it the panel scrolls. */
const GRID_MIN_H = 3 * ROW_H + 2;
/** Width of a note's resize zone at its end, px (the last third of a one-step note). */
const EDGE_PX = 8;

/**
 * Piano roll (PR-01 to PR-04): a canvas for the picture and a role="grid"
 * DOM mirror ("Notes") for input and assistive technology. Rows are pitches
 * (or the GM drum rows), columns are grid steps of the clip; only visible rows
 * and columns, plus the cursor cell, are in the DOM. Every edit goes through
 * the note commands.
 *
 * Keys on a cell: arrows move the cursor (Left from the first column reaches
 * the row header); Enter adds or removes a note; Delete removes it;
 * Alt+arrows move it; Shift+Left/Right change its length; Shift+Up/Down change
 * its velocity by 8; Q quantizes the clip. Pointer: a drag from an empty
 * cell draws a note as long as the drag (grid steps); a drag from a note's
 * right edge (the last 8 px, cursor ew-resize) resizes it and from its body
 * moves it, in one edit on release. Drum notes keep one length. The cursor is
 * a pitch and a tick, so it stays put when the grid or the row set changes.
 * `stepInsertRef.current(pitch)` is set while step input is on.
 */
export default function PianoRollGrid({ project, trackId, view, onViewChange, onEdit, readOnly, stepInsertRef }) {
  const engine = getEngine();
  const track = project.tracks[trackId];
  const device = project.devices[track.deviceIds[0]];
  const isDrums = device?.type === 'drums';
  const clips = track.clipIds.map((id) => project.clips[id]).filter((c) => c?.kind === 'midi');
  const clip = clips.find((c) => c.id === view.panelClipId) ?? clips[0] ?? null;

  const [grid, setGrid] = useState(DEFAULT_GRID);
  const [showAll, setShowAll] = useState(false);
  // An empty clip starts in step input, so the empty-editor hint holds: pressing a key adds a note.
  const [stepInput, setStepInput] = useState(() => !clip || clip.notes.length === 0);
  const [previewOn, setPreviewOn] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [ghost, setGhost] = useState(null); // provisional note during a drag
  const [scroll, setScroll] = useState({ scrollX: 0, scrollY: 0, width: 800, height: VIEW_HEIGHT });
  const [announcement, announce] = useThrottledAnnouncer();

  const rows = useMemo(() => rowPitches(isDrums, showAll), [isDrums, showAll]);
  const meter = useMemo(() => new MeterMap(project.meter), [project.meter]);
  const { numerator, denominator } = project.meter[0];
  const barTicks = ticksPerBar(numerator, denominator);
  const beatTicks = (4 * PPQ) / denominator;
  const newClipLength = 4 * barTicks;
  const length = clip?.length ?? newClipLength;
  const cols = Math.max(1, Math.ceil(length / grid));

  // Open on the clip's notes (their median pitch), else on C4 or the kick.
  const [cursor, setCursorState] = useState(() => {
    const pitches = (clip?.notes ?? []).map((n) => n.pitch).sort((x, y) => x - y);
    return { pitch: pitches.length ? pitches[Math.floor(pitches.length / 2)] : isDrums ? 36 : 60, tick: 0 };
  });
  const cursorRef = useRef(cursor);
  function setCursor(next) {
    cursorRef.current = next;
    setCursorState(next);
  }

  /** Row of the cursor pitch, or the row with the nearest pitch when that pitch has no row. */
  const row = useMemo(() => {
    const exact = rows.indexOf(cursor.pitch);
    if (exact >= 0) return exact;
    let best = 0;
    rows.forEach((p, i) => {
      if (Math.abs(p - cursor.pitch) < Math.abs(rows[best] - cursor.pitch)) best = i;
    });
    return best;
  }, [rows, cursor.pitch]);
  const col = cursor.tick === HEADER ? -1 : Math.min(cols - 1, Math.floor(cursor.tick / grid));

  const scroller = useRef(null);
  // The grid fills its panel, so its visible area follows the panel's size.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setScroll({ scrollX: el.scrollLeft, scrollY: el.scrollTop, width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const gridRef = useRef(null);
  const focused = useRef(false);
  const drag = useRef(null);

  const commands = usePianoRollCommands({
    project, trackId, clipId: clip?.id ?? null, grid, isDrums, meter, readOnly,
    preview: previewOn,
    onEdit,
    onClipCreated: (clipId) => onViewChange({ panelClipId: clipId, openPanel: 'pianoroll' }),
    announce,
  });

  function moveCursor(r, c) {
    const rr = Math.max(0, Math.min(rows.length - 1, r));
    const cc = Math.max(-1, Math.min(cols - 1, c));
    setCursor({ pitch: rows[rr], tick: cc < 0 ? HEADER : cc * grid });
  }

  // Step input: computer-keyboard and MIDI notes insert at the cursor and advance it.
  useEffect(() => {
    if (!stepInsertRef) return undefined;
    stepInsertRef.current = stepInput
      ? (pitch) => {
          const tick = Math.max(0, cursorRef.current.tick);
          const clipLength = commands.clipLength(newClipLength);
          if (tick >= clipLength) {
            announce('End of clip');
            return;
          }
          commands.add(tick, pitch, { sounds: false });
          setCursor({ pitch: cursorRef.current.pitch, tick: tick + grid });
        }
      : null;
    return () => {
      stepInsertRef.current = null;
    };
  });

  // Keep the cursor in view when the rows, the grid or the cursor change.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = row * ROW_H;
    if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2);
    }
    if (col >= 0) {
      const left = col * CELL_W;
      const visible = el.clientWidth - LABEL_W;
      if (left < el.scrollLeft || left + CELL_W > el.scrollLeft + visible) el.scrollLeft = Math.max(0, left - visible / 2);
    }
    setScroll({ scrollX: el.scrollLeft, scrollY: el.scrollTop, width: el.clientWidth, height: el.clientHeight });
  }, [rows, grid, row, col]);

  // Keep the focused cell focused as the cursor moves.
  useEffect(() => {
    if (!focused.current) return;
    gridRef.current?.querySelector(`[data-cell="${row}:${col}"]`)?.focus({ preventScroll: true });
  }, [row, col]);

  const firstRow = Math.max(0, Math.floor(scroll.scrollY / ROW_H) - 1);
  const lastRow = Math.min(rows.length - 1, Math.ceil((scroll.scrollY + scroll.height) / ROW_H) + 1);
  const firstCol = Math.max(0, Math.floor(scroll.scrollX / CELL_W) - 1);
  const lastCol = Math.min(cols - 1, Math.ceil((scroll.scrollX + scroll.width - LABEL_W) / CELL_W) + 1);
  const visibleRows = [];
  for (let r = firstRow; r <= lastRow; r++) visibleRows.push(r);
  if (!visibleRows.includes(row)) visibleRows.push(row);
  const visibleCols = [];
  for (let c = firstCol; c <= lastCol; c++) visibleCols.push(c);

  const cellNote = (r, c) => (clip ? noteAt(clip, c * grid, rows[r], grid, isDrums) : undefined);

  /**
   * "C4, bar 2 beat 1" for an empty cell; the note's full name where a note
   * starts (plus "and N more notes" when notes are stacked); "…, held" where a
   * note continues.
   */
  function cellLabel(r, c) {
    const pitch = rows[r];
    const base = `${rowLabel(pitch, isDrums)}, ${positionText(c * grid, meter, grid)}`;
    if (!clip) return base;
    const starting = notesStartingIn(clip, c * grid, pitch, grid);
    if (starting.length > 0) {
      const more = starting.length - 1;
      return more > 0 ? `${noteText(starting[0], isDrums, meter, grid)}, and ${more} more ${more === 1 ? 'note' : 'notes'}` : noteText(starting[0], isDrums, meter, grid);
    }
    return cellNote(r, c) ? `${base}, held` : base;
  }

  function onKeyDown(e) {
    const key = e.key;
    if (col < 0) {
      // On a row header: arrows move; Space and Enter preview through the button itself.
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
        moveCursor(row + (key === 'ArrowUp' ? -1 : 1), col);
      } else if (key === 'ArrowRight') {
        e.preventDefault();
        moveCursor(row, 0);
      }
      return;
    }
    const note = cellNote(row, col);
    const handled = () => e.preventDefault();
    if (e.altKey && note && key.startsWith('Arrow')) {
      handled();
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const moved = commands.move(note.id, key === 'ArrowLeft' ? -grid : grid, 0);
        if (moved) setCursor({ pitch: moved.pitch, tick: moved.tick });
      } else {
        const r = row + (key === 'ArrowUp' ? -1 : 1);
        if (r < 0 || r >= rows.length) return;
        const moved = commands.move(note.id, 0, rows[r] - rows[row]);
        if (moved) setCursor({ pitch: moved.pitch, tick: cursor.tick });
      }
      return;
    }
    if (e.shiftKey && note && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      handled();
      commands.resize(note.id, key === 'ArrowLeft' ? -grid : grid);
      return;
    }
    if (e.shiftKey && note && (key === 'ArrowUp' || key === 'ArrowDown')) {
      handled();
      commands.velocity(note.id, key === 'ArrowUp' ? 8 : -8);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    switch (key) {
      case 'ArrowUp': handled(); moveCursor(row - 1, col); break;
      case 'ArrowDown': handled(); moveCursor(row + 1, col); break;
      case 'ArrowLeft': handled(); moveCursor(row, col - 1); break;
      case 'ArrowRight': handled(); moveCursor(row, col + 1); break;
      case 'Home': handled(); moveCursor(row, 0); break;
      case 'End': handled(); moveCursor(row, cols - 1); break;
      case 'Enter': {
        handled();
        const added = commands.toggle(col * grid, rows[row]);
        setSelectedId(added?.id ?? null);
        break;
      }
      case 'Delete':
      case 'Backspace':
        if (note) {
          handled();
          commands.remove(note.id);
        }
        break;
      default:
        if (e.code === 'KeyQ' && !e.shiftKey) {
          handled();
          commands.quantize();
        }
    }
  }

  function cellFromPoint(e) {
    const rect = gridRef.current.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left - LABEL_W) / CELL_W);
    const r = Math.floor((e.clientY - rect.top) / ROW_H);
    return { r: Math.max(0, Math.min(rows.length - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) };
  }

  /** True when the pointer is on the resize zone at the end of `note` (pitched tracks only). */
  function onNoteEdge(e, note) {
    if (!note || isDrums) return false;
    const x = e.clientX - gridRef.current.getBoundingClientRect().left - LABEL_W;
    const end = ((note.tick + note.length) / grid) * CELL_W;
    return x <= end && end - x <= EDGE_PX;
  }

  /** Steps of a note drawn from the origin cell to cell `c`: at least one, within the clip. */
  const drawSteps = (d) => Math.max(1, Math.min(cols, d.c + 1) - d.originC);

  /** The note a drag would leave: the origin note moved or resized by the drag, or the drawn note; clamped like the commands. */
  function dragResult(d) {
    if (d.mode === 'add') return { id: null, tick: d.originC * grid, pitch: rows[d.originR], length: drawSteps(d) * grid, velocity: 100 };
    const n = d.note;
    const dTick = (d.c - d.originC) * grid;
    if (d.mode === 'resize') return { ...n, length: Math.max(grid, n.length + dTick) };
    const r = Math.max(0, Math.min(rows.length - 1, rows.indexOf(n.pitch) + (d.r - d.originR)));
    return { ...n, tick: Math.max(0, Math.min(length - 1, n.tick + dTick)), pitch: rows[r] };
  }

  function endDrag() {
    drag.current = null;
    setGhost(null);
  }

  function onPointerDown(e) {
    const cell = e.target.closest?.('[data-cell]');
    if (!cell || e.button !== 0 || readOnly) return;
    const [r, c] = cell.dataset.cell.split(':').map(Number);
    if (c < 0) return; // row headers keep their native click (preview or audition)
    const note = cellNote(r, c);
    const mode = note ? (onNoteEdge(e, note) ? 'resize' : 'move') : 'add';
    drag.current = { originR: r, originC: c, r, c, note, mode, moved: false };
    gridRef.current.setPointerCapture(e.pointerId);
    moveCursor(r, c);
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) {
      // Hover: the resize cursor over a note's right edge.
      const cell = e.target.closest?.('[data-cell]');
      const [r, c] = cell ? cell.dataset.cell.split(':').map(Number) : [-1, -1];
      gridRef.current.style.cursor = !readOnly && c >= 0 && onNoteEdge(e, cellNote(r, c)) ? 'ew-resize' : '';
      return;
    }
    if (!(e.buttons & 1)) {
      endDrag();
      return;
    }
    if (d.mode === 'add' && isDrums) return; // drum notes have one length
    const { r, c } = cellFromPoint(e);
    if (r === d.r && c === d.c) return;
    d.moved = true;
    d.r = d.mode === 'move' ? r : d.originR;
    d.c = c;
    const next = dragResult(d);
    setGhost(next);
    setCursor({ pitch: next.pitch, tick: next.tick + (d.mode === 'move' ? 0 : next.length - grid) });
  }

  function onPointerUp() {
    const d = drag.current;
    endDrag();
    if (!d) return;
    if (d.moved && d.note) {
      const next = dragResult(d);
      if (d.mode === 'resize') commands.resize(d.note.id, next.length - d.note.length);
      else commands.move(d.note.id, next.tick - d.note.tick, next.pitch - d.note.pitch);
      setSelectedId(d.note.id);
      return;
    }
    if (d.note) {
      setSelectedId(d.note.id);
      commands.select(d.note);
    } else {
      // A drawn note is added at one step, then given the drawn length.
      const drawn = dragResult(d);
      const added = commands.add(drawn.tick, drawn.pitch);
      if (added && drawn.length > added.length) commands.resize(added.id, drawn.length - added.length);
      setSelectedId(added?.id ?? null);
    }
  }

  function onDoubleClick(e) {
    // Pointer capture retargets dblclick to the grid, so the cell comes from the pointer position.
    if (readOnly) return;
    const rect = gridRef.current.getBoundingClientRect();
    if (e.clientX - rect.left - scroll.scrollX < LABEL_W) return; // over the row headers
    const { r, c } = cellFromPoint(e);
    const note = cellNote(r, c);
    if (note) commands.remove(note.id);
  }

  const loopValue = clip?.loopLength ? String(clip.loopLength / barTicks) : 'off';
  const title = `Piano roll: ${track.name}`;

  return (
    <section aria-labelledby="pianoroll-heading" className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <h2 id="pianoroll-heading" className={sectionHeading}>
        {title}
      </h2>
      <Toolbar label="Piano roll tools" className="flex flex-wrap items-center gap-2">
        <Select id="pianoroll-grid" label="Grid" labelClassName="w-auto" className="w-auto" value={String(grid)} onChange={(v) => setGrid(Number(v))} options={GRID_OPTIONS} />
        <Select
          id="pianoroll-loop"
          label="Clip loop"
          labelClassName="w-auto"
          className="w-auto"
          value={loopValue}
          disabled={!clip || readOnly}
          onChange={(v) => commands.setLoop(v === 'off' ? null : Number(v) * barTicks)}
          options={LOOP_OPTIONS}
        />
        <IconToggle icon="footprints" label="Step input" pressed={stepInput} onClick={() => setStepInput(!stepInput)} data-help="Step input: each played note is added at the cursor, which then moves one grid step." />
        <IconToggle icon="volume-2" label="Preview notes" pressed={previewOn} onClick={() => setPreviewOn(!previewOn)} data-help="Preview notes: placing or moving a note plays it." />
        <IconButton icon="grid-3x3" label="Quantize" shortcut="Q" onClick={() => commands.quantize()} disabled={!clip || readOnly} data-help="Quantize (Q): moves every note to the grid." />
        {isDrums ? <IconToggle icon="list" label="Show all notes" pressed={showAll} onClick={() => setShowAll(!showAll)} data-help="Show all notes: every General MIDI drum row, not only the kit's." /> : null}
      </Toolbar>
      </div>
      <p id="pianoroll-help" className="sr-only">
        {PIANO_ROLL_HELP}
      </p>
      {/* The grid keeps three rows at the smallest dock; the panel scrolls below that. */}
      <div className="relative flex flex-1 flex-col" style={{ minHeight: GRID_MIN_H }}>
        <div
          ref={scroller}
          data-help={PIANO_ROLL_HELP}
          className="relative min-h-0 flex-1 overflow-auto rounded-ds border border-border-strong bg-surface"
          style={{ scrollPaddingLeft: LABEL_W }}
          onScroll={(e) => {
            const el = e.currentTarget;
            setScroll({ scrollX: el.scrollLeft, scrollY: el.scrollTop, width: el.clientWidth, height: el.clientHeight });
          }}
        >
          <div className="relative" style={{ width: LABEL_W + cols * CELL_W, height: rows.length * ROW_H }}>
            <PianoRollCanvas
              view={scroll}
              rows={rows}
              clip={clip}
              clipStart={clip?.start ?? 0}
              grid={grid}
              barTicks={barTicks}
              beatTicks={beatTicks}
              isDrums={isDrums}
              selectedId={selectedId}
              ghost={ghost}
              noteColor={track.color}
            />
            <div
              ref={gridRef}
              role="grid"
              aria-label="Notes"
              aria-describedby="pianoroll-help"
              aria-rowcount={rows.length}
              aria-colcount={cols + 1}
              className="absolute inset-0"
              style={{ touchAction: 'none' }}
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={endDrag}
              onLostPointerCapture={() => {
                if (drag.current && !drag.current.moved) return;
                endDrag();
              }}
              onDoubleClick={onDoubleClick}
              onFocus={() => (focused.current = true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) focused.current = false;
              }}
            >
              {visibleRows.map((r) => {
                const pitch = rows[r];
                const label = rowLabel(pitch, isDrums);
                const cellCols = r === row && col >= 0 && !visibleCols.includes(col) ? [...visibleCols, col] : visibleCols;
                return (
                  <div key={pitch} role="row" aria-rowindex={r + 1} className="absolute left-0" style={{ top: r * ROW_H, height: ROW_H, width: LABEL_W + cols * CELL_W }}>
                    <div
                      role="rowheader"
                      aria-colindex={1}
                      className="absolute z-10 flex items-center gap-1 border-r border-b border-border bg-surface-2 px-1 text-xs"
                      style={{ left: scroll.scrollX, width: LABEL_W, height: ROW_H }}
                    >
                      {/* Drum rows show "36 Kick"; the name and tooltip keep the GM name. */}
                      <button
                        type="button"
                        data-cell={`${r}:-1`}
                        tabIndex={r === row && col < 0 ? 0 : -1}
                        aria-label={isDrums ? label : undefined}
                        title={isDrums ? `Audition ${label}` : `Preview ${label}`}
                        className={cx('min-h-6 min-w-0 truncate rounded-ds px-1 text-left hover:bg-hover', focusRing)}
                        onClick={() => engine.preview(pitch, 100)}
                      >
                        {rowShortLabel(pitch, isDrums)}
                      </button>
                      {isDrums && inChokeGroup(pitch) ? (
                        <span className="ml-auto shrink-0 pr-1 text-[0.625rem] whitespace-nowrap text-muted uppercase" title="Hi-hat choke group: one cuts the others off">
                          Choke<span className="sr-only"> group</span>
                        </span>
                      ) : null}
                    </div>
                    {cellCols.map((c) => {
                      const note = cellNote(r, c);
                      const starts = note && note.tick >= c * grid && note.tick < (c + 1) * grid;
                      return (
                        <div
                          key={c}
                          role="gridcell"
                          data-cell={`${r}:${c}`}
                          data-note={starts ? 'start' : note ? 'held' : undefined}
                          aria-colindex={c + 2}
                          aria-selected={note ? note.id === selectedId : false}
                          aria-label={cellLabel(r, c)}
                          tabIndex={r === row && c === col ? 0 : -1}
                          className={cx('absolute', focusRing, 'focus-visible:z-20')}
                          style={{ left: LABEL_W + c * CELL_W, top: 0, width: CELL_W, height: ROW_H }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {(clip?.notes.length ?? 0) === 0 ? (
          // Over the grid rather than above it, so adding the first note does not move the grid.
          <div className="pointer-events-none absolute top-1 right-2 z-30 flex flex-col gap-0.5 rounded-ds border border-border bg-surface/95 px-2 py-1 text-sm" style={{ left: LABEL_W + 8 }}>
            <p>Press a key or click the grid to add a note. Drag to draw a longer one.</p>
            <section aria-labelledby="keyboard-map-heading" className="flex flex-wrap items-baseline gap-x-2">
              <h3 id="keyboard-map-heading" className={groupHeading}>
                Keyboard map
              </h3>
              <p className="text-xs">Keys A to K play the notes C to C. Z and X move the keyboard down or up an octave.</p>
            </section>
          </div>
        ) : null}
      </div>
      {/* The lane stays with an empty clip ("No notes"), so the layout does not jump. */}
      <VelocityLane
        clip={clip}
        isDrums={isDrums}
        meter={meter}
        grid={grid}
        cols={cols}
        scrollX={scroll.scrollX}
        selectedId={selectedId}
        onSelect={(id) => {
          const note = clip?.notes.find((n) => n.id === id);
          setSelectedId(id);
          if (note) setCursor({ pitch: note.pitch, tick: note.tick });
        }}
        commands={commands}
        readOnly={readOnly}
      />
      <StatusRegion visuallyHidden>{announcement}</StatusRegion>
    </section>
  );
}
