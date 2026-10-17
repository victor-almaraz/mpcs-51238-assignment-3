/*
 * Working state of one project (assignment-3-scope.md, Resume where you left
 * off), stored at w-rack:v1:view:<id>, separate from the project so view
 * changes never rewrite project data. The transport is never part of it: a
 * project always opens stopped.
 */
import { viewKey } from '../storage/keys.js';
import { isViewState } from '../storage/schema.js';
import { createDebouncedWriter, onPageHide, readJson, writeJson } from '../storage/storage.js';
import { STORAGE_FULL, STORAGE_UNAVAILABLE } from './store.js';

/** Zoom factors, in steps of 2× (1 = 100 %). */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;

/** Debounce for working-state saves, in ms. */
export const VIEW_SAVE_DELAY_MS = 500;

/** Open editor panels. */
export const PANELS = ['pianoroll', 'clip'];

/** Tabs of the editor's lower dock. */
export const DOCK_TABS = ['editor', 'devices', 'mixer'];

/** Snap grids in quarter notes (ARR-04), coarse to fine; 'bar' snaps to the bar. */
export const SNAP_GRIDS = ['bar', '1', '0.5', '0.25'];

/** The snap grid `steps` places finer (+) or coarser (−) than `grid`, clamped to SNAP_GRIDS. */
export function stepGrid(grid, steps) {
  const i = Math.max(0, SNAP_GRIDS.indexOf(grid));
  return SNAP_GRIDS[Math.min(SNAP_GRIDS.length - 1, Math.max(0, i + steps))];
}

/**
 * Default working state for `doc`: playhead at tick 0, the document's loop
 * range (off), 100 % zoom, no scroll, no selection, no open panel, the
 * Editor tab of the dock, snap on to the quarter note.
 */
export function defaultView(doc) {
  return {
    playhead: 0,
    loop: doc.loop ? { start: doc.loop.start, end: doc.loop.end } : null,
    loopEnabled: false,
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    selectedTrackId: null,
    selectedClipIds: [],
    openPanel: null,
    panelClipId: null,
    dock: 'editor',
    snap: '1',
    snapOn: true,
  };
}

const isTick = (v) => Number.isInteger(v) && v >= 0;

/**
 * Returns a valid working state for `doc` from stored `raw`: each field that is
 * missing, out of range or refers to a deleted track or clip takes its default.
 */
export function normalizeView(raw, doc) {
  const view = defaultView(doc);
  if (!isViewState(raw)) return view;
  if (isTick(raw.playhead)) view.playhead = raw.playhead;
  if (raw.loop === null || (raw.loop && isTick(raw.loop.start) && isTick(raw.loop.end) && raw.loop.end > raw.loop.start)) {
    view.loop = raw.loop && { start: raw.loop.start, end: raw.loop.end };
  }
  view.loopEnabled = raw.loopEnabled === true && view.loop !== null;
  if (typeof raw.zoom === 'number' && raw.zoom >= ZOOM_MIN && raw.zoom <= ZOOM_MAX) view.zoom = raw.zoom;
  if (Number.isFinite(raw.scrollX) && raw.scrollX >= 0) view.scrollX = raw.scrollX;
  if (Number.isFinite(raw.scrollY) && raw.scrollY >= 0) view.scrollY = raw.scrollY;
  if (typeof raw.selectedTrackId === 'string' && doc.tracks[raw.selectedTrackId]) view.selectedTrackId = raw.selectedTrackId;
  if (Array.isArray(raw.selectedClipIds)) view.selectedClipIds = raw.selectedClipIds.filter((id) => doc.clips[id]);
  if (PANELS.includes(raw.openPanel)) {
    view.openPanel = raw.openPanel;
    view.panelClipId = typeof raw.panelClipId === 'string' && doc.clips[raw.panelClipId] ? raw.panelClipId : null;
  }
  if (DOCK_TABS.includes(raw.dock)) view.dock = raw.dock;
  if (SNAP_GRIDS.includes(raw.snap)) view.snap = raw.snap;
  if (typeof raw.snapOn === 'boolean') view.snapOn = raw.snapOn;
  return view;
}

/**
 * Reads the working state of `doc`. Unreadable stored state falls back to the
 * default; it is replaced on the next view change.
 */
export function readView(doc) {
  const result = readJson(viewKey(doc.id), isViewState);
  return normalizeView(result.ok ? result.value : null, doc);
}

function writeView({ projectId, view }) {
  const result = writeJson(viewKey(projectId), view);
  if (result.ok) return result;
  return { ok: false, error: result.error.code === 'quota' ? STORAGE_FULL : STORAGE_UNAVAILABLE };
}

const writer = createDebouncedWriter({ write: writeView, delayMs: VIEW_SAVE_DELAY_MS, keyOf: (v) => v.projectId });

/** Records a working-state change; it saves after 500 ms and when the page is hidden. */
export function saveView(projectId, view) {
  onPageHide(writer.flush);
  writer.schedule({ projectId, view });
}

/** Writes a pending working-state change now. */
export const flushView = writer.flush;

/** Working-state save state: { status, error }, as for project saves. */
export const getViewSaveState = writer.getState;
export const subscribeViewSaveState = writer.subscribe;

/** Returns `zoom` multiplied by 2 ** `steps`, clamped to the zoom range. */
export function stepZoom(zoom, steps) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * 2 ** steps));
}
