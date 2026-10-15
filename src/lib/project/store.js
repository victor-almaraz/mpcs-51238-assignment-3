/*
 * Saved projects in localStorage (through src/lib/storage) and unsaved example
 * copies in memory. Functions return { ok, value } or { ok: false, error } with
 * user-facing error text; nothing here throws for storage conditions.
 */
import { INDEX_KEY, projectKey } from '../storage/keys.js';
import { readJson, readRaw, subscribe as subscribeStorage, writeJson, removeKey } from '../storage/storage.js';
import { findExample } from './examples.js';
import { copyDocument, createId, createProject as buildProject } from './model.js';

export const PROJECT_UNREADABLE = 'A saved project could not be read.';
export const STORAGE_FULL = "This device's browser storage is full. Save a .wrack file, then delete unused projects.";
export const STORAGE_UNAVAILABLE = 'This browser does not allow W-Rack to store projects.';

/** projectId → { doc, exampleSlug } for example copies not saved yet. */
const unsaved = new Map();

function writeError(error) {
  return error.code === 'quota' ? STORAGE_FULL : STORAGE_UNAVAILABLE;
}

const isIndex = (v) => Array.isArray(v) && v.every((e) => e && typeof e.id === 'string' && typeof e.name === 'string');
const isProject = (id) => (v) => v && typeof v === 'object' && v.id === id && Number.isInteger(v.schemaVersion);

function readIndex() {
  const result = readJson(INDEX_KEY, isIndex);
  if (!result.ok) return { ok: false, error: result.error.code === 'unreadable' ? PROJECT_UNREADABLE : STORAGE_UNAVAILABLE };
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
 * Writes `doc` and its index entry. On failure the previous saved state stays.
 * Returns { ok: true, value: doc } or { ok: false, error }.
 */
export function saveProject(doc) {
  const index = readIndex();
  if (!index.ok) return index;
  const written = writeJson(projectKey(doc.id), doc);
  if (!written.ok) return { ok: false, error: writeError(written.error) };
  const previous = index.value.find((e) => e.id === doc.id);
  const entry = { id: doc.id, name: doc.name, modifiedAt: doc.modifiedAt, archiveSavedAt: previous?.archiveSavedAt ?? null };
  const nextIndex = [...index.value.filter((e) => e.id !== doc.id), entry];
  const indexed = writeJson(INDEX_KEY, nextIndex);
  if (!indexed.ok) {
    if (!previous) removeKey(projectKey(doc.id));
    return { ok: false, error: writeError(indexed.error) };
  }
  unsaved.delete(doc.id);
  return { ok: true, value: doc };
}

/** Creates and saves a project from validated New project form values. */
export function createProject({ name, tempo, timeSignature }, now = new Date().toISOString()) {
  return saveProject(buildProject({ name, tempo, timeSignature, now }));
}

/**
 * Loads a project: an unsaved example copy from memory, else the saved JSON.
 * Returns { ok: true, value: doc } (null when no such project) or
 * { ok: false, error } when the saved JSON cannot be read.
 */
export function loadProject(id) {
  const copy = unsaved.get(id);
  if (copy) return { ok: true, value: copy.doc };
  const result = readJson(projectKey(id), isProject(id));
  if (!result.ok) return { ok: false, error: result.error.code === 'unreadable' ? PROJECT_UNREADABLE : STORAGE_UNAVAILABLE };
  return { ok: true, value: result.value };
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
 * Applies an edited document. The first edit of an example copy saves it as a
 * project. Returns the saveProject result.
 */
export function commitEdit(doc, now = new Date().toISOString()) {
  return saveProject({ ...doc, modifiedAt: now });
}

/** Returns a new project ID. */
export function newProjectId() {
  return createId('prj');
}
