/*
 * localStorage key names (assignment-3-scope.md, Persistence). Every Wrack key
 * starts with KEY_PREFIX; "Clear all data" and first-visit detection rely on it.
 */
export const KEY_PREFIX = 'wrack:';
const V1 = `${KEY_PREFIX}v1:`;

/** Project summaries: ID, name, last-edited date, last archive-save date. */
export const INDEX_KEY = `${V1}index`;

/** Personal preset library. */
export const PRESETS_KEY = `${V1}presets`;

/** Saved settings. */
export const SETTINGS_KEY = `${V1}settings`;

/** Project JSON for one project. */
export function projectKey(id) {
  return `${V1}project:${id}`;
}

/** Working state (playhead, loop, zoom, selection) for one project. */
export function viewKey(id) {
  return `${V1}view:${id}`;
}

/** True for keys this app owns. */
export function isWrackKey(key) {
  return typeof key === 'string' && key.startsWith(KEY_PREFIX);
}
