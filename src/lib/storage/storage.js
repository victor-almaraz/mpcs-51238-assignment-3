/*
 * The only module that touches localStorage. Reads parse inside a guard and
 * report failures as values; writes report quota errors as values. Other errors
 * are rethrown. Nothing runs at import time, so server rendering never reaches
 * localStorage.
 */
import { isWrackKey } from './keys.js';

const listeners = new Set();

/** Returns window.localStorage, or null where it does not exist or is blocked. */
function getStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch (err) {
    if (err?.name === 'SecurityError') return null;
    throw err;
  }
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

/** True when any W-Rack key exists (a return visit). False when storage is unavailable. */
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
