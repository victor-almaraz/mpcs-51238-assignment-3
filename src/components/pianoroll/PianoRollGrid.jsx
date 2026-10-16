'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import StatusRegion from '@/components/ui/StatusRegion';
import Toggle from '@/components/ui/Toggle';
import Toolbar from '@/components/ui/Toolbar';
import useThrottledAnnouncer from '@/components/ui/useThrottledAnnouncer';
import { cx, focusRing, sectionHeading } from '@/design-systems/industrial/classes';
import { PPQ } from '@/dsp/core/constants';
import { MeterMap } from '@/dsp/timing/meter-map';
import { getEngine } from '@/lib/audio/engine-client';
import { noteAt, notesStartingIn } from '@/lib/project/midi-commands';
import { ticksPerBar } from '@/lib/project/model';
import PianoRollCanvas from './PianoRollCanvas';
import { CELL_W, DEFAULT_GRID, GRIDS, LABEL_W, ROW_H, inChokeGroup, noteText, positionText, rowLabel, rowPitches } from './layout';
import usePianoRollCommands from './usePianoRollCommands';

const VIEW_HEIGHT = 480;
const GRID_OPTIONS = GRIDS.map((g) => ({ value: String(g.value), label: g.label }));
const LOOP_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: '1', label: '1 bar' },
  { value: '2', label: '2 bars' },
  { value: '4', label: '4 bars' },
];
/** Cursor tick that marks the row header. */
const HEADER = -1;

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
 * its velocity by 8; Q quantizes the clip. A drag moves (or, from a note's last
 * cell, resizes) a note in one edit on release. The cursor is a pitch and a
 * tick, so it stays put when the grid or the row set changes.
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
  const [stepInput, setStepInput] = useState(false);
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

  /** The note a drag would leave: the origin note moved or resized by the drag, clamped like the commands. */
  function dragResult(d) {
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
    const lastCell = note ? Math.floor((note.tick + note.length - 1) / grid) : -1;
    const mode = note ? (c === lastCell && note.length > grid && !isDrums ? 'resize' : 'move') : 'add';
    drag.current = { originR: r, originC: c, r, c, note, mode, moved: false };
    gridRef.current.setPointerCapture(e.pointerId);
    moveCursor(r, c);
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d) return;
    if (!(e.buttons & 1)) {
      endDrag();
      return;
    }
    if (!d.note) return;
    const { r, c } = cellFromPoint(e);
    if (r === d.r && c === d.c) return;
    d.moved = true;
    d.r = d.mode === 'resize' ? d.originR : r;
    d.c = c;
    const next = dragResult(d);
    setGhost(next);
    setCursor({ pitch: next.pitch, tick: next.tick + (d.mode === 'resize' ? next.length - grid : 0) });
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
      const added = commands.add(d.c * grid, rows[d.r]);
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
    <section aria-labelledby="pianoroll-heading" className="flex flex-col gap-2">
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
        <Toggle pressed={stepInput} onClick={() => setStepInput(!stepInput)}>
          Step input
        </Toggle>
        <Toggle pressed={previewOn} onClick={() => setPreviewOn(!previewOn)}>
          Preview notes
        </Toggle>
        <Button onClick={() => commands.quantize()} disabled={!clip || readOnly}>
          Quantize
        </Button>
        {isDrums ? (
          <Toggle pressed={showAll} onClick={() => setShowAll(!showAll)}>
            Show all notes
          </Toggle>
        ) : null}
      </Toolbar>
      <p id="pianoroll-help" className="text-xs text-muted">
        Arrow keys move. Enter adds or removes a note; Delete removes it. Alt+arrows move it; Shift+Left and Right change
        its length; Shift+Up and Down change its velocity. Q quantizes.
      </p>
      <div
        ref={scroller}
        className="relative overflow-auto rounded-ds border border-border-strong bg-surface"
        style={{ height: VIEW_HEIGHT, scrollPaddingLeft: LABEL_W }}
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
                    <button
                      type="button"
                      data-cell={`${r}:-1`}
                      tabIndex={r === row && col < 0 ? 0 : -1}
                      title={isDrums ? `Audition ${label}` : `Preview ${label}`}
                      className={cx('min-h-6 truncate rounded-ds px-1 text-left hover:bg-hover', focusRing)}
                      onClick={() => engine.preview(pitch, 100)}
                    >
                      {label}
                    </button>
                    {isDrums && inChokeGroup(pitch) ? <span className="ml-auto pr-1 text-[0.625rem] text-muted uppercase">Choke group</span> : null}
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
      <StatusRegion visuallyHidden>{announcement}</StatusRegion>
    </section>
  );
}
