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
export const STORAGE_UNAVAILABLE = 'This browser does not allow W-Rack to store projects.';
export const PROJECT_NEWER =
  'This project was saved by a newer version of W-Rack. It opens read-only, and changes are not saved.';

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

/**
 * Writes `doc` and its index entry now. On failure the previous saved state
 * stays. Returns { ok: true, value: doc } or { ok: false, error }.
 */
export function saveProject(doc) {
  const index = readIndex();
  if (!index.ok) return index;
  const written = writeJson(projectKey(doc.id), doc);
  if (!written.ok) return { ok: false, error: writeError(written.error) };
  const previous = index.value.find((e) => e.id === doc.id);
  const entry = { id: doc.id, name: doc.name, modifiedAt: doc.modifiedAt, archiveSavedAt: previous?.archiveSavedAt ?? null };
  const indexed = writeJson(INDEX_KEY, [...index.value.filter((e) => e.id !== doc.id), entry]);
  if (!indexed.ok) {
    if (!previous) removeKey(projectKey(doc.id));
    return { ok: false, error: writeError(indexed.error) };
  }
  unsaved.delete(doc.id);
  return { ok: true, value: doc };
}

const writer = createDebouncedWriter({ write: saveProject, delayMs: SAVE_DELAY_MS, keyOf: (doc) => doc.id });
let latest = null; // the newest edited document, saved or pending

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
  latest = { ...doc, modifiedAt: now };
  onPageHide(flushSaves);
  writer.schedule(latest);
  return latest;
}

/** Creates and saves a project from validated New project form values. */
export function createProject({ name, tempo, timeSignature }, now = new Date().toISOString()) {
  return saveProject(buildProject({ name, tempo, timeSignature, now }));
}

/**
 * Loads a project: the newest edit or unsaved example copy in memory, else the
 * saved JSON brought to the current schema. Returns { ok: true, value, readOnly }
 * (value null when no such project) or { ok: false, error }.
 */
export function loadProject(id) {
  if (latest?.id === id) return { ok: true, value: latest, readOnly: false };
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
 * Removes a saved project, its working state and its index entry.
 * Returns { ok: true } or { ok: false, error }.
 */
export function deleteProject(id) {
  const index = readIndex();
  if (!index.ok) return index;
  const indexed = writeJson(INDEX_KEY, index.value.filter((e) => e.id !== id));
  if (!indexed.ok) return { ok: false, error: writeError(indexed.error) };
  removeKey(projectKey(id));
  removeKey(viewKey(id));
  unsaved.delete(id);
  if (latest?.id === id) latest = null;
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

/** Returns a new project ID. */
export function newProjectId() {
  return createId('prj');
}
