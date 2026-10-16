/*
 * `.wrack` archives from and to project documents (assignment-3-scope.md,
 * `.wrack` archive). An archive holds `project.json` first, then the original
 * bytes of every referenced source at its SourceRef path,
 * `audio/<sourceId>.<ext>`. Opening validates the archive and checks that each
 * audio entry's SHA-256 equals its sourceId.
 */
import { audioSourceId, validateArchive, PROJECT_PATH } from './validate.js';
import { writeZip } from './zip-writer.js';

const encoder = new TextEncoder();

/** Lowercase hex SHA-256 of an ArrayBuffer. */
export async function sha256Hex(buffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds a `.wrack` Blob from a project document and `sources`, an iterable of
 * { sourceId, bytes: Blob }. Sources the project does not reference are left
 * out. Resolves to { ok: true, value: { blob, missing: [sourceId] } }, where
 * `missing` lists referenced sources absent from `sources`, or to the writer's
 * { ok: false, error: { code, message, path? } }. `options` pass to writeZip.
 */
export async function buildArchive(project, sources, options) {
  const bytesById = new Map();
  for (const { sourceId, bytes } of sources) bytesById.set(sourceId, bytes);

  const entries = [{ path: PROJECT_PATH, data: encoder.encode(JSON.stringify(project)) }];
  const missing = [];
  for (const [sourceId, ref] of Object.entries(project.sources ?? {})) {
    if (audioSourceId(ref?.path ?? '') !== sourceId) {
      return {
        ok: false,
        error: {
          code: 'invalid-path',
          path: ref?.path,
          message: `The path for source ${sourceId} is not audio/${sourceId}.<ext>.`,
        },
      };
    }
    const bytes = bytesById.get(sourceId);
    if (bytes === undefined) missing.push(sourceId);
    else entries.push({ path: ref.path, data: bytes });
  }

  const written = await writeZip(entries, options);
  if (!written.ok) return written;
  return { ok: true, value: { blob: written.value, missing } };
}

/**
 * Opens a `.wrack` Blob or File. Resolves to
 * { ok: true, value: { project, audio: Map(sourceId → Blob) } }
 * or { ok: false, error: { errors: [{ code, path?, message }] } }.
 */
export async function openArchive(file) {
  const validated = await validateArchive(file);
  if (!validated.ok) return validated;
  const errors = [];
  const audio = new Map();
  for (const [sourceId, { path, blob }] of validated.value.audio) {
    if ((await sha256Hex(await blob.arrayBuffer())) === sourceId) audio.set(sourceId, blob);
    else errors.push({ code: 'hash-mismatch', path, message: `${path} does not match its source ID.` });
  }
  if (errors.length > 0) return { ok: false, error: { errors } };
  return { ok: true, value: { project: validated.value.project, audio } };
}
