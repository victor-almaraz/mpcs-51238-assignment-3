/*
 * Data saved under the app's former name, "w-rack". The localStorage keys
 * "w-rack:…" move to "wrack:…" (storage.js runs this once per page), and the
 * IndexedDB database "w-rack" is copied into "wrack" (audio-store.js).
 */
import { KEY_PREFIX } from './keys.js';

export const LEGACY_KEY_PREFIX = 'w-rack:';
export const LEGACY_DB_NAME = 'w-rack';

/**
 * Moves every legacy key of `storage` (a Storage) to the current prefix and
 * returns the number moved. A key already present under the current name
 * wins; its legacy copy is dropped. When a copy does not fit, the legacy key
 * is removed first to make room, and restored if the copy still fails.
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
    if (storage.getItem(next) !== null) {
      storage.removeItem(key);
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
