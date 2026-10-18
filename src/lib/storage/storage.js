/*
 * The only module that touches localStorage. Reads parse inside a guard and
 * report failures as values; writes report quota errors as values. Other errors
 * are rethrown. Nothing runs at import time, so server rendering never reaches
 * localStorage.
 */
import { isWrackKey } from './keys.js';
import { migrateLegacyKeys } from './legacy-names.js';

const listeners = new Set();
let migrated = false;

/**
 * Returns window.localStorage, or null where it does not exist or is blocked.
 * The first call on a page moves keys saved under the former name (legacy-names.js).
 */
function getStorage() {
  let storage;
  try {
    storage = globalThis.localStorage ?? null;
  } catch (err) {
    if (err?.name === 'SecurityError') return null;
    throw err;
  }
  if (storage && !migrated) {
    migrated = true;
    try {
      migrateLegacyKeys(storage);
    } catch (err) {
      console.error('Moving data saved under the former name failed', err);
    }
  }
  return storage;
}

function notify() {
  for (const listener of listeners) listener();
}

/** True for the quota errors browsers throw from setItem. */
export function isQuotaError(err) {
  return err?.name === 'QuotaExceededError' || err?.code === 22 || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/**
 * Reads and parses `key`.
 * Returns { ok: true, value } (value is null when the key is absent),
 * or { ok: false, error: { code: 'unavailable' | 'unreadable' } }.
 * `check(value)` may reject parsed JSON whose shape is wrong; it returns a boolean.
 */
export function readJson(key, check = () => true) {
  const storage = getStorage();
  if (!storage) return { ok: false, error: { code: 'unavailable' } };
  const raw = storage.getItem(key);
  if (raw === null) return { ok: true, value: null };
  let value;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) return { ok: false, error: { code: 'unreadable' } };
    throw err;
  }
  return check(value) ? { ok: true, value } : { ok: false, error: { code: 'unreadable' } };
}

/** Returns the raw string stored at `key`, or null. For change detection only. */
export function readRaw(key) {
  return getStorage()?.getItem(key) ?? null;
}

/**
 * Serializes `value` to `key`. Returns { ok: true } or
 * { ok: false, error: { code: 'quota' | 'unavailable' } }. A failed write leaves
 * the previous value in place.
 */
export function writeJson(key, value) {
  const storage = getStorage();
  if (!storage) return { ok: false, error: { code: 'unavailable' } };
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (isQuotaError(err)) return { ok: false, error: { code: 'quota' } };
    throw err;
  }
  notify();
  return { ok: true };
}

/** Removes `key`. Absent keys are not an error. */
export function removeKey(key) {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(key);
  notify();
}

/** True when any Wrack key exists (a return visit). False when storage is unavailable. */
export function hasAnyWrackKey() {
  const storage = getStorage();
  if (!storage) return false;
  for (let i = 0; i < storage.length; i++) {
    if (isWrackKey(storage.key(i))) return true;
  }
  return false;
}

/**
 * Calls `onChange` after every write or removal in this tab and on storage
 * events from other tabs. Returns an unsubscribe function.
 */
export function subscribe(onChange) {
  listeners.add(onChange);
  globalThis.addEventListener?.('storage', onChange);
  return () => {
    listeners.delete(onChange);
    globalThis.removeEventListener?.('storage', onChange);
  };
}

/** Keys of every Wrack entry, in storage order. Empty when storage is unavailable. */
export function listWrackKeys() {
  const storage = getStorage();
  if (!storage) return [];
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (isWrackKey(key)) keys.push(key);
  }
  return keys;
}

/** localStorage stores strings as UTF-16: 2 bytes per code unit. */
export const BYTES_PER_CODE_UNIT = 2;

/** Origin quota assumed for the usage display, in bytes (5 MiB). */
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;

/** Usage above which /settings warns, in bytes (4 MiB, project limit). */
export const STORAGE_WARNING_BYTES = 4 * 1024 * 1024;

/** Estimated bytes used by Wrack keys and values. */
export function estimateUsage() {
  const storage = getStorage();
  if (!storage) return 0;
  let units = 0;
  for (const key of listWrackKeys()) units += key.length + (storage.getItem(key)?.length ?? 0);
  return units * BYTES_PER_CODE_UNIT;
}

/**
 * Returns a writer that coalesces values and calls `write(value)` once
 * `delayMs` after the last schedule() (assignment-3-scope.md: 500 ms).
 * `write` returns { ok } or { ok: false, error }. A failed value stays pending,
 * so the next flush retries it. A value for a different `keyOf` flushes the
 * pending one first.
 *
 * State: { status: 'idle' | 'pending' | 'saved' | 'error', error }.
 */
export function createDebouncedWriter({ write, delayMs, keyOf = () => '' }) {
  let pending = null;
  let timer = null;
  let state = { status: 'idle', error: null };
  const stateListeners = new Set();

  function setState(next) {
    state = next;
    for (const listener of stateListeners) listener();
  }

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (pending === null) return state;
    const value = pending;
    const result = write(value);
    if (result.ok) {
      if (pending === value) pending = null;
      setState({ status: 'saved', error: null });
    } else {
      setState({ status: 'error', error: result.error });
    }
    return state;
  }

  function schedule(value) {
    if (pending !== null && keyOf(pending) !== keyOf(value)) flush();
    pending = value;
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
    if (state.status !== 'error') setState({ status: 'pending', error: null });
  }

  return {
    schedule,
    flush,
    getState: () => state,
    hasPending: () => pending !== null,
    subscribe(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
}

const hideHandlers = new Set();

function runHideHandlers() {
  for (const handler of hideHandlers) handler();
}

/**
 * Runs `handler` when the page is hidden or unloaded (pagehide, and
 * visibilitychange to hidden). Registering the same function twice has no effect.
 */
export function onPageHide(handler) {
  if (hideHandlers.size === 0 && typeof document !== 'undefined') {
    globalThis.addEventListener('pagehide', runHideHandlers);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') runHideHandlers();
    });
  }
  hideHandlers.add(handler);
}
