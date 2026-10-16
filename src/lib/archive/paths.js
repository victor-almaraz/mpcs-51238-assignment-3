/*
 * Path rules for archive entry names (assignment-3-scope.md, `.wrack` archive):
 * no `..` segments, no absolute paths (leading `/` or a drive letter), no
 * backslashes, no NUL, at most 255 UTF-8 bytes. The writer refuses such names
 * and the validator rejects archives that hold them.
 */

/** Longest entry name in UTF-8 bytes (project limit). */
export const MAX_PATH_BYTES = 255;

const encoder = new TextEncoder();

/** `path` with NUL shown as `\0`, for messages. */
export function showPath(path) {
  return path.replace(/\0/g, '\\0');
}

/** The first rule `path` breaks as { code, message }, or null for a safe path. */
export function pathProblem(path) {
  const shown = showPath(path);
  if (path.length === 0) return { code: 'empty-path', message: 'The archive contains an entry with an empty name.' };
  if (path.includes('\0')) return { code: 'nul-path', message: `The archive contains a path with a NUL character: ${shown}.` };
  if (path.includes('\\')) return { code: 'backslash-path', message: `The archive contains a path with a backslash: ${shown}.` };
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return { code: 'absolute-path', message: `The archive contains an absolute path: ${shown}.` };
  }
  if (path.split('/').includes('..')) return { code: 'unsafe-path', message: `The archive contains an unsafe path: ${shown}.` };
  if (encoder.encode(path).length > MAX_PATH_BYTES) {
    return { code: 'long-path', message: `The archive contains a path longer than ${MAX_PATH_BYTES} bytes: ${shown}.` };
  }
  return null;
}
