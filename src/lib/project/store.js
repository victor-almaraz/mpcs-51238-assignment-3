/*
 * Saved projects in localStorage (through src/lib/storage) and unsaved example
 * copies in memory. Functions return { ok, value } or { ok: false, error } with
 * user-facing error text; nothing here throws for storage conditions.
 * Edits save 500 ms after the last change and flush when the page is hidden.
 */
import { INDEX_KEY, projectKey, viewKey } from '../storage/keys.js';
import { migrate } from '../storage/migrate.js';
import { isIndex, isProjectDoc } from '../storage/schema.js';
import {
  createDebouncedWriter,
  discardPendingWrites,
  onPageHide,
  readJson,
  readRaw,
  removeKey,
  subscribe as subscribeStorage,
  writeJson,
} from '../storage/storage.js';
import { findExample } from './examples.js';
import { copyDocument, createId, createProject as buildProject } from './model.js';

export const PROJECT_UNREADABLE = 'A saved project could not be read.';
export const STORAGE_FULL = "This device's browser storage is full. Save a .wrack file, then delete unused projects.";
export const STORAGE_UNAVAILABLE = 'This browser does not allow Wrack to store projects.';
export const PROJECT_NEWER =
  'This project was saved by a newer version of Wrack. It opens read-only, and changes are not saved.';

/** Debounce for project saves, in ms (project limit). */
export const SAVE_DELAY_MS = 500;

/** projectId → { doc, exampleSlug } for example copies not saved yet. */
const unsaved = new Map();

function writeError(error) {
  return error.code === 'quota' ? STORAGE_FULL : STORAGE_UNAVAILABLE;
}

function readError(error) {
  return error.code === 'unreadable' ? PROJECT_UNREADABLE : STORAGE_UNAVAILABLE;
}

function readIndex() {
  const result = readJson(INDEX_KEY, isIndex);
  if (!result.ok) return { ok: false, error: readError(result.error) };
  return { ok: true, value: result.value ?? [] };
}

/** Saved project summaries, most recently edited first. */
export function listProjects() {
  const index = readIndex();
  if (!index.ok) return index;
  const sorted = [...index.value].sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
  return { ok: true, value: sorted };
}

/** Raw index string for useSyncExternalStore snapshots; null when absent. */
export function getIndexSnapshot() {
  return readRaw(INDEX_KEY);
}

/** Subscribes to saved-project changes. Returns an unsubscribe function. */
export function subscribeProjects(onChange) {
  return subscribeStorage(onChange);
}

/** Writes `doc` and its index entry. On failure the previous saved state stays. */
function writeProject(doc) {
  const index = readIndex();
  if (!index.ok) return index;
  const written = writeJson(projectKey(doc.id), doc);
  if (!written.ok) return { ok: false, error: writeError(written.error) };
  const previous = index.value.find((e) => e.id === doc.id);
  const { numerator, denominator } = doc.meter[0];
  const entry = {
    id: doc.id,
    name: doc.name,
    modifiedAt: doc.modifiedAt,
    archiveSavedAt: previous?.archiveSavedAt ?? null,
    archivedSources: previous?.archivedSources ?? [],
    // List metadata (RET-01); origin is the example title for a saved example copy.
    bpm: doc.tempo[0].bpm,
    timeSignature: `${numerator}/${denominator}`,
    trackCount: doc.trackOrder.length,
    origin: previous?.origin ?? findExample(unsaved.get(doc.id)?.exampleSlug)?.title ?? null,
  };
  const indexed = writeJson(INDEX_KEY, [...index.value.filter((e) => e.id !== doc.id), entry]);
  if (!indexed.ok) {
    if (!previous) removeKey(projectKey(doc.id));
    return { ok: false, error: writeError(indexed.error) };
  }
  unsaved.delete(doc.id);
  return { ok: true, value: doc };
}

/** Pending edits by project ID; a failed save stays pending and retries on the next flush. */
const writer = createDebouncedWriter({ write: writeProject, delayMs: SAVE_DELAY_MS, keyOf: (doc) => doc.id });

/**
 * Writes `doc` and its index entry now. On failure the previous saved state
 * stays. A successful save replaces any pending edit of the same project, so
 * callers pass a document built on loadProject(), which includes that edit.
 * Returns { ok: true, value: doc } or { ok: false, error }.
 */
export function saveProject(doc) {
  const result = writeProject(doc);
  if (result.ok) writer.discard(doc.id);
  return result;
}

/** Writes any pending edit now. Returns the save state. */
export function flushSaves() {
  return writer.flush();
}

/** Save state for the editor header: { status: 'idle' | 'pending' | 'saved' | 'error', error }. */
export const getSaveState = writer.getState;

/** Subscribes to save-state changes. Returns an unsubscribe function. */
export const subscribeSaveState = writer.subscribe;

/** True while an edit is pending or failed to save. */
export function hasUnsavedEdits() {
  return writer.hasPending();
}

/**
 * Records an edited document. It saves 500 ms after the last edit and when the
 * page is hidden. The first edit of an example copy saves it as a project.
 */
export function commitEdit(doc, now = new Date().toISOString()) {
  const edited = { ...doc, modifiedAt: now };
  onPageHide(flushSaves);
  writer.schedule(edited);
  return edited;
}

/** Creates and saves a project from validated New project form values. */
export function createProject({ name, tempo, timeSignature }, now = new Date().toISOString()) {
  return saveProject(buildProject({ name, tempo, timeSignature, now }));
}

/**
 * Loads a project: its pending edit (not yet written, or failed to write) or
 * unsaved example copy in memory, else the saved JSON brought to the current
 * schema. Returns { ok: true, value, readOnly } (value null when no such
 * project) or { ok: false, error }.
 */
export function loadProject(id) {
  const edited = writer.pendingFor(id);
  if (edited) return { ok: true, value: edited, readOnly: false };
  const copy = unsaved.get(id);
  if (copy) return { ok: true, value: copy.doc, readOnly: false };
  const result = readJson(projectKey(id), (v) => isProjectDoc(v, id));
  if (!result.ok) return { ok: false, error: readError(result.error) };
  if (result.value === null) return { ok: true, value: null, readOnly: false };
  const migrated = migrate(result.value);
  if (!migrated.ok) return { ok: false, error: PROJECT_UNREADABLE };
  return { ok: true, value: migrated.value, readOnly: migrated.newer };
}

/**
 * Removes a saved project, its working state and its index entry, and drops
 * their pending writes so a later flush does not restore them.
 * Returns { ok: true } or { ok: false, error }.
 */
export function deleteProject(id) {
  const index = readIndex();
  if (!index.ok) return index;
  const indexed = writeJson(INDEX_KEY, index.value.filter((e) => e.id !== id));
  if (!indexed.ok) return { ok: false, error: writeError(indexed.error) };
  removeKey(projectKey(id));
  removeKey(viewKey(id));
  discardPendingWrites(id);
  unsaved.delete(id);
  return { ok: true };
}

/**
 * Creates an unsaved, in-memory copy of example `slug` under project ID `id`,
 * named "<Example> (copy)". Repeated calls with the same ID return the same copy.
 * Returns the copy, or null for an unknown slug.
 */
export function openExampleCopy(slug, id, now = new Date().toISOString()) {
  const existing = unsaved.get(id);
  if (existing) return existing.doc;
  const example = findExample(slug);
  if (!example) return null;
  const doc = copyDocument(example.doc, { id, name: `${example.title} (copy)`, now });
  unsaved.set(id, { doc, exampleSlug: slug });
  return doc;
}

/** True while `id` is an example copy that has not been saved. */
export function isUnsavedCopy(id) {
  return unsaved.has(id);
}

/**
 * Documents held only in memory: pending edits (including failed saves) and
 * example copies not saved yet. A pending edit stands in for its project's
 * copy, so each project ID appears once.
 */
export function unsavedDocuments() {
  const docs = new Map(writer.pendingValues().map((doc) => [doc.id, doc]));
  for (const [id, { doc }] of unsaved) if (!docs.has(id)) docs.set(id, doc);
  return [...docs.values()];
}

/**
 * Records that `doc` was saved to a .wrack file: the index entry keeps the
 * document's modifiedAt and the sources the file carries. Returns { ok } or
 * { ok: false, error }.
 */
export function markArchiveSaved(doc, sourceIds) {
  const index = readIndex();
  if (!index.ok) return index;
  const entries = index.value.map((e) => (e.id === doc.id ? { ...e, archiveSavedAt: doc.modifiedAt, archivedSources: [...sourceIds] } : e));
  const written = writeJson(INDEX_KEY, entries);
  return written.ok ? { ok: true } : { ok: false, error: writeError(written.error) };
}

/**
 * Archive state of `doc` for the "Not saved to file" indicator:
 * { saved: false } while edits or loaded sources are newer than the last
 * .wrack save, plus `unarchived`, the loaded sourceIds the file lacks.
 * `isLoaded(sourceId)` says whether a source is in memory.
 */
export function archiveState(doc, isLoaded) {
  const index = readIndex();
  const entry = index.ok ? index.value.find((e) => e.id === doc.id) : null;
  const archived = new Set(entry?.archivedSources ?? []);
  const unarchived = Object.keys(doc.sources).filter((id) => isLoaded(id) && !archived.has(id));
  const editsNewer = !entry?.archiveSavedAt || entry.archiveSavedAt !== doc.modifiedAt;
  return { saved: !editsNewer && unarchived.length === 0, unarchived };
}

/** Returns a new project ID. */
export function newProjectId() {
  return createId('prj');
}
