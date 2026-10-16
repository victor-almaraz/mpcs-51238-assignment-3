/*
 * `.wrack` archive validation (assignment-3-scope.md, `.wrack` archive). An
 * archive holds exactly `project.json` and `audio/<sourceId>.<ext>` entries,
 * where sourceId is 64 lowercase hex digits (SHA-256). Checks, with project
 * limits: safe paths; at most 1000 entries; no duplicate paths compared
 * case-insensitively; method 0; no encryption flag; sizes consistent with the
 * file; total at most 500 MB; project.json at most 5 MB with JSON depth at most
 * 64; CRC of every entry. Every problem found is reported, each as
 * { code, path?, message } with a plain sentence naming the path.
 */
import { pathProblem, showPath } from './paths.js';
import { readEntryBytes, scanZip, verifyEntry } from './zip-reader.js';
import { MAX_ARCHIVE_BYTES } from './zip-writer.js';

export { MAX_ARCHIVE_BYTES };

/** Most entries in an archive (project limit). */
export const MAX_ENTRIES = 1000;
/** Largest project.json, in bytes (project limit). */
export const MAX_PROJECT_JSON_BYTES = 5 * 1024 * 1024;
/** Deepest nesting of objects and arrays in project.json (project limit). */
export const MAX_JSON_DEPTH = 64;

export const PROJECT_PATH = 'project.json';
/** `audio/<sourceId>.<ext>`: capture 1 is the sourceId, capture 2 the extension. */
export const AUDIO_PATH = /^audio\/([0-9a-f]{64})\.([A-Za-z0-9]{1,16})$/;

/** General-purpose flag bits 0 (encrypted) and 6 (strong encryption). */
const ENCRYPTION_FLAGS = 0x0041;

const textDecoder = new TextDecoder('utf-8', { fatal: true });

/** sourceId for an `audio/<sourceId>.<ext>` path, or null. */
export function audioSourceId(path) {
  return AUDIO_PATH.exec(path)?.[1] ?? null;
}

/**
 * Deepest nesting of `{` and `[` in JSON text, ignoring brackets inside
 * strings. A scan of the text, so deep input cannot overflow the stack.
 */
export function jsonDepth(text) {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++; // backslash: skip the escaped character
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) max = Math.max(max, ++depth);
    else if (c === 0x7d || c === 0x5d) depth--;
  }
  return max;
}

/** Every policy problem in `entries` (from zip-reader.js) that needs no data reads. */
function entryErrors(entries) {
  const errors = [];
  if (entries.length > MAX_ENTRIES) {
    errors.push({
      code: 'too-many-entries',
      message: `The archive contains ${entries.length} entries; the limit is ${MAX_ENTRIES}.`,
    });
  }

  const byKey = new Map();
  const sourcePaths = new Map();
  let total = 0;
  let projects = 0;
  for (const entry of entries) {
    const { path } = entry;
    const shown = showPath(path);
    total += entry.size;

    const problem = pathProblem(path);
    if (problem) errors.push({ ...problem, path });

    const key = path.toLowerCase();
    const first = byKey.get(key);
    if (first === undefined) byKey.set(key, path);
    else if (first === path) errors.push({ code: 'duplicate', path, message: `The archive lists ${shown} twice.` });
    else {
      errors.push({
        code: 'duplicate',
        path,
        message: `The archive lists ${showPath(first)} and ${shown}, which differ only in letter case.`,
      });
    }

    if (entry.method !== 0) {
      errors.push({ code: 'method', path, message: `${shown} is compressed; .wrack archives store files uncompressed.` });
    }
    if (entry.flags & ENCRYPTION_FLAGS) {
      errors.push({ code: 'encrypted', path, message: `${shown} is encrypted.` });
    }
    if (entry.method === 0 && entry.compressedSize !== entry.size) {
      errors.push({ code: 'size-mismatch', path, message: `${shown} has sizes that do not match its data.` });
    }

    if (path === PROJECT_PATH) {
      projects++;
      if (entry.size > MAX_PROJECT_JSON_BYTES) {
        errors.push({ code: 'project-too-large', path, message: 'project.json is larger than 5 MB.' });
      }
    } else if (!problem) {
      const sourceId = audioSourceId(path);
      if (sourceId === null) {
        errors.push({ code: 'unexpected-entry', path, message: `The archive contains an unexpected entry: ${shown}.` });
      } else if (sourcePaths.has(sourceId) && sourcePaths.get(sourceId).toLowerCase() !== key) {
        errors.push({
          code: 'duplicate-source',
          path,
          message: `The archive contains more than one file for source ${sourceId}: ${sourcePaths.get(sourceId)} and ${path}.`,
        });
      } else sourcePaths.set(sourceId, path);
    }
  }

  if (projects === 0) errors.push({ code: 'no-project', message: 'The archive does not contain project.json.' });
  if (total > MAX_ARCHIVE_BYTES) {
    errors.push({ code: 'too-large', message: 'The archive holds more than 500 MB of files.' });
  }
  return errors;
}

/**
 * Checks parsed entries against the archive rules without reading data.
 * Returns { ok: true, value: entries } or { ok: false, error: { errors } }.
 */
export function validateEntries(entries) {
  const errors = entryErrors(entries);
  return errors.length > 0 ? { ok: false, error: { errors } } : { ok: true, value: entries };
}

/** Decodes and parses project.json bytes. Returns { ok, value } or { ok: false, error }. */
function parseProject(bytes) {
  const fail = (code, message) => ({ ok: false, error: { code, path: PROJECT_PATH, message } });
  let text;
  try {
    text = textDecoder.decode(bytes);
  } catch {
    return fail('project-encoding', 'project.json is not valid UTF-8 text.');
  }
  if (jsonDepth(text) > MAX_JSON_DEPTH) {
    return fail('project-depth', `project.json is nested more than ${MAX_JSON_DEPTH} levels deep.`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('project-json', 'project.json is not valid JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('project-shape', 'project.json does not contain a project.');
  }
  return { ok: true, value };
}

/**
 * Validates a `.wrack` Blob or File. Resolves to
 * { ok: true, value: { project, audio: Map(sourceId → { path, blob, size }) } }
 * or { ok: false, error: { errors: [{ code, path?, message }] } }.
 * Data is read only when the declared entries stay within the count and size
 * limits, which bounds the bytes read.
 */
export async function validateArchive(file) {
  if (file.size > MAX_ARCHIVE_BYTES) {
    return { ok: false, error: { errors: [{ code: 'too-large', message: 'The archive file is larger than 500 MB.' }] } };
  }
  const scan = await scanZip(file);
  const errors = [...scan.errors, ...entryErrors(scan.entries)];
  const withinLimits = !errors.some((e) => e.code === 'too-large' || e.code === 'too-many-entries');

  let project = null;
  const audio = new Map();
  if (withinLimits) {
    for (const entry of scan.entries) {
      const readable =
        entry.blob !== null && entry.method === 0 && !(entry.flags & ENCRYPTION_FLAGS) && entry.compressedSize === entry.size;
      if (!readable) continue;
      if (entry.path === PROJECT_PATH) {
        if (entry.size > MAX_PROJECT_JSON_BYTES) continue;
        const read = await readEntryBytes(entry);
        if (!read.ok) {
          errors.push(read.error);
          continue;
        }
        const parsed = parseProject(read.value);
        if (parsed.ok) project = parsed.value;
        else errors.push(parsed.error);
      } else {
        const checked = await verifyEntry(entry);
        if (!checked.ok) errors.push(checked.error);
        const sourceId = audioSourceId(entry.path);
        if (checked.ok && sourceId !== null) audio.set(sourceId, { path: entry.path, blob: entry.blob, size: entry.size });
      }
    }
  }

  if (errors.length > 0) return { ok: false, error: { errors } };
  return { ok: true, value: { project, audio } };
}
