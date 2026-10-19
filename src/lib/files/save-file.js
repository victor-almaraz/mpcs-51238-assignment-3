/*
 * Saving a generated file (assignment-3-scope.md, .wrack archive and Export):
 * the File System Access API's showSaveFilePicker when present (Chromium),
 * else a temporary <a download> whose object URL is revoked after the click.
 */

/** A file name for `name` with `ext`: characters file systems reject become "-". */
export function safeFileName(name, ext) {
  const safe = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'Untitled';
  return `${safe}${ext}`;
}

/**
 * Saves `blob` as `name`. `type` is { description, accept } for the picker.
 * Resolves to 'saved' when the picker wrote the file, 'cancelled' when the
 * picker was dismissed, or 'started' when a download began: the browser does
 * not report whether a download completes or is dismissed.
 */
export async function saveFile(blob, name, type) {
  if (typeof window.showSaveFilePicker === 'function') {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: name, types: [type] });
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      throw err;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'saved';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'started';
}
