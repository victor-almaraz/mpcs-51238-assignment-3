/*
 * Data saved under the app's former name, "w-rack". The localStorage keys
 * "w-rack:…" move to "wrack:…" (storage.js runs this once per page), and the
 * IndexedDB database "w-rack" is copied into "wrack" (audio-store.js).
 */
import { INDEX_KEY, KEY_PREFIX, projectKey } from './keys.js';

export const LEGACY_KEY_PREFIX = 'w-rack:';
export const LEGACY_DB_NAME = 'w-rack';

const PROJECT_KEY_PREFIX = projectKey('');

/** Parsed JSON of `raw`, or undefined when it does not parse. */
function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const modifiedAt = (v) => (typeof v?.modifiedAt === 'string' ? v.modifiedAt : '');

/**
 * The value to keep at `key` when both the legacy value and the current one
 * exist. The project index merges both lists by project ID; a project
 * document keeps the copy edited last, so it matches the merged index entry.
 * Any other key, and values that do not parse, keep the current value.
 */
function resolve(key, legacy, current) {
  const a = parse(legacy);
  const b = parse(current);
  if (key === INDEX_KEY) {
    if (!Array.isArray(a) || !Array.isArray(b)) return current;
    const byId = new Map();
    for (const entry of [...b, ...a]) {
      const id = entry?.id;
      if (typeof id !== 'string') continue;
      const kept = byId.get(id);
      if (!kept || modifiedAt(entry) > modifiedAt(kept)) byId.set(id, entry);
    }
    return JSON.stringify([...byId.values()]);
  }
  if (key.startsWith(PROJECT_KEY_PREFIX) && a !== undefined && b !== undefined) {
    return modifiedAt(a) > modifiedAt(b) ? legacy : current;
  }
  return current;
}

/**
 * Moves every legacy key of `storage` (a Storage) to the current prefix and
 * returns the number moved. When a key exists under both names, the value
 * resolve() picks stays under the current name and the legacy key is dropped;
 * a value that does not fit leaves both keys as they are. When a copy does not
 * fit, the legacy key is removed first to make room, and restored if the copy
 * still fails.
 */
export function migrateLegacyKeys(storage) {
  const legacy = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(LEGACY_KEY_PREFIX)) legacy.push(key);
  }
  let moved = 0;
  for (const key of legacy) {
    const next = KEY_PREFIX + key.slice(LEGACY_KEY_PREFIX.length);
    const value = storage.getItem(key);
    const current = storage.getItem(next);
    if (current !== null) {
      const kept = resolve(next, value, current);
      try {
        if (kept !== current) storage.setItem(next, kept);
        storage.removeItem(key);
      } catch {
        // Both copies stay; the next page load tries again.
      }
      continue;
    }
    try {
      storage.setItem(next, value);
      storage.removeItem(key);
      moved++;
    } catch {
      storage.removeItem(key);
      try {
        storage.setItem(next, value);
        moved++;
      } catch {
        storage.setItem(key, value);
      }
    }
  }
  return moved;
}
