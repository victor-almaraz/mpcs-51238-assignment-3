/*
 * The only module that touches IndexedDB (assignment-3-scope.md, Audio
 * persistence): database "w-rack" version 1, object store "sources" keyed by
 * sourceId. A record is { sourceId, name, mimeType, size, sha256, bytes } where
 * `bytes` is a Blob of the original file, never decoded PCM. Records are
 * written once after a successful import and are never evicted to make room.
 * Every function resolves to { ok: true, value } or { ok: false, error: { code } }
 * with code 'unavailable', 'quota' or 'failed'.
 */

export const DB_NAME = 'w-rack';
export const DB_VERSION = 1;
export const STORE = 'sources';

/** An import that would leave less than this share of the quota free is session-only. */
export const MIN_FREE_FRACTION = 0.1;

let dbPromise = null;

const fail = (code, cause) => ({ ok: false, error: { code, cause } });

function isQuota(err) {
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
}

/** Opens (and on first use creates) the database. Resolves to the IDBDatabase or null. */
function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'sourceId' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      console.error('IndexedDB open failed', request.error);
      dbPromise = null;
      resolve(null);
    };
    request.onblocked = () => console.error('IndexedDB open blocked by another tab');
  });
  return dbPromise;
}

/** Runs `fn(store)` in a transaction and resolves with the request result. */
async function run(mode, fn) {
  const db = await open();
  if (!db) return fail('unavailable');
  return new Promise((resolve) => {
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch (err) {
      resolve(fail('failed', err));
      return;
    }
    const request = fn(tx.objectStore(STORE));
    let value;
    request.onsuccess = () => {
      value = request.result;
    };
    tx.oncomplete = () => resolve({ ok: true, value });
    tx.onabort = () => resolve(fail(isQuota(tx.error) ? 'quota' : 'failed', tx.error));
    tx.onerror = (event) => {
      event.preventDefault();
    };
  });
}

/** Stores a record (see the module comment). An existing record for the sourceId is kept as is. */
export async function put(record) {
  const existing = await get(record.sourceId);
  if (existing.ok && existing.value) return { ok: true, value: existing.value };
  return run('readwrite', (store) => store.add(record));
}

/** The record for `sourceId`, or null when absent. */
export async function get(sourceId) {
  const result = await run('readonly', (store) => store.get(sourceId));
  return result.ok ? { ok: true, value: result.value ?? null } : result;
}

/** Removes the record for `sourceId`; absent records are not an error. */
export async function remove(sourceId) {
  return run('readwrite', (store) => store.delete(sourceId));
}

/** Every record's metadata, without the bytes: [{ sourceId, name, mimeType, size, sha256 }]. */
export async function list() {
  const result = await run('readonly', (store) => store.getAll());
  if (!result.ok) return result;
  return { ok: true, value: (result.value ?? []).map(({ bytes: _bytes, ...meta }) => meta) };
}

/** Origin storage usage and quota in bytes from navigator.storage.estimate(), or null. */
export async function usage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return { ok: true, value: null };
  const { usage: used = 0, quota = 0 } = await navigator.storage.estimate();
  return { ok: true, value: { used, quota } };
}

/**
 * True when storing `bytes` more would leave at least 10 % of the quota free.
 * Without an estimate the import is allowed and the write itself decides.
 */
export async function hasRoomFor(bytes) {
  const estimate = await usage();
  if (!estimate.ok || !estimate.value || !estimate.value.quota) return true;
  const { used, quota } = estimate.value;
  return quota - (used + bytes) >= MIN_FREE_FRACTION * quota;
}

let persistRequested = false;

/** Requests persistent storage once per page, from the first import (a user action). */
export async function requestPersistence() {
  if (persistRequested || typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  persistRequested = true;
  return navigator.storage.persist();
}

/** Deletes the whole database ("Clear all data"). */
export function deleteDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve({ ok: true });
  return open().then((db) => {
    db?.close();
    dbPromise = null;
    return new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve({ ok: true });
      request.onerror = () => resolve(fail('failed', request.error));
      request.onblocked = () => resolve(fail('failed'));
    });
  });
}
