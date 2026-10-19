/*
 * Reference cleanup for stored audio (assignment-3-scope.md, Audio
 * persistence): a source record stays while any saved project, pending edit
 * or unsaved example copy references it. Runs after a project is deleted and
 * after an edit drops a source.
 */
import { listProjects, loadProject, unsavedDocuments } from '../project/store.js';
import { list, remove } from '../storage/audio-store.js';
import { markUnstored } from './decode.js';

/**
 * sourceId → names of the projects that reference it, or null when a project
 * could not be read (then nothing may be removed). Saved projects are read
 * through loadProject(), so a pending edit counts in place of its saved copy;
 * documents only in memory (a first save that failed, an unsaved example
 * copy) count too.
 */
export function sourceReferences() {
  const index = listProjects();
  if (!index.ok) return null;
  const refs = new Map();
  const add = (doc, name) => {
    for (const id of Object.keys(doc?.sources ?? {})) {
      if (!refs.has(id)) refs.set(id, []);
      refs.get(id).push(name);
    }
  };
  const indexed = new Set();
  for (const entry of index.value) {
    const project = loadProject(entry.id);
    if (!project.ok) return null;
    indexed.add(entry.id);
    add(project.value, entry.name);
  }
  for (const doc of unsavedDocuments()) if (!indexed.has(doc.id)) add(doc, doc.name);
  return refs;
}

/** Stored sources with the projects that use them: [{ sourceId, name, size, projects }]. */
export async function storedSources() {
  const records = await list();
  if (!records.ok) return records;
  const refs = sourceReferences() ?? new Map();
  return { ok: true, value: records.value.map((r) => ({ ...r, projects: refs.get(r.sourceId) ?? [] })) };
}

/**
 * Removes stored sources that no project references (sourceReferences). `keep` lists
 * sourceIds an open, not yet saved document uses. Resolves to the removed IDs.
 */
export async function pruneStoredSources(keep = []) {
  const refs = sourceReferences();
  if (refs === null) return [];
  const records = await list();
  if (!records.ok) return [];
  const removed = [];
  for (const { sourceId } of records.value) {
    if (refs.has(sourceId) || keep.includes(sourceId)) continue;
    const result = await remove(sourceId);
    if (!result.ok) continue;
    markUnstored(sourceId);
    removed.push(sourceId);
  }
  return removed;
}

/** Removes one stored source ("Delete" in /settings). */
export async function removeStoredSource(sourceId) {
  const result = await remove(sourceId);
  if (result.ok) markUnstored(sourceId);
  return result;
}
