/*
 * Reference cleanup for stored audio (assignment-3-scope.md, Audio
 * persistence): a source record stays while any saved project references it.
 * Runs after a project is deleted and after an edit drops a source.
 */
import { listProjects, loadProject } from '../project/store.js';
import { list, remove } from '../storage/audio-store.js';
import { markUnstored } from './decode.js';

/**
 * sourceId → names of the saved projects that reference it, or null when a
 * project could not be read (then nothing may be removed).
 */
export function sourceReferences() {
  const index = listProjects();
  if (!index.ok) return null;
  const refs = new Map();
  for (const entry of index.value) {
    const project = loadProject(entry.id);
    if (!project.ok) return null;
    for (const id of Object.keys(project.value?.sources ?? {})) {
      if (!refs.has(id)) refs.set(id, []);
      refs.get(id).push(entry.name);
    }
  }
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
 * Removes stored sources that no saved project references. `keep` lists
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
