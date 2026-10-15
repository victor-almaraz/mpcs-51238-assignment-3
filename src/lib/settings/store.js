/*
 * Saved settings (assignment-3-scope.md, Saved settings) at w-rack:v1:settings.
 * "Remember settings on this device" is on by default and held in memory:
 * turning it off removes the key, nothing is written for the rest of the page
 * session, and the next visit starts from the defaults.
 */
import { SETTINGS_KEY } from '../storage/keys.js';
import { isSettings } from '../storage/schema.js';
import { readJson, removeKey, writeJson } from '../storage/storage.js';
import { STORAGE_FULL, STORAGE_UNAVAILABLE } from '../project/store.js';

/** Master volume limits, in dB (assignment-3-scope.md, Mixer). */
export const MASTER_VOLUME_MIN_DB = -60;
export const MASTER_VOLUME_MAX_DB = 0;

/** Computer-keyboard octave range (the octave of the A key's C). */
export const OCTAVE_MIN = 0;
export const OCTAVE_MAX = 8;

/** WAV export formats (assignment-3-scope.md, Export). */
export const EXPORT_FORMATS = ['wav16', 'wav24', 'wav32f'];

export const DEFAULT_SETTINGS = Object.freeze({
  masterVolumeDb: -12,
  keyboardOctave: 4,
  exportFormat: 'wav16',
  metronome: false,
  volumeNoticeDismissed: false,
});

const isNumberIn = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Returns settings from stored `raw`: each invalid or missing field takes its default. */
export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!isSettings(raw)) return s;
  if (isNumberIn(raw.masterVolumeDb, MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB)) s.masterVolumeDb = raw.masterVolumeDb;
  if (Number.isInteger(raw.keyboardOctave) && isNumberIn(raw.keyboardOctave, OCTAVE_MIN, OCTAVE_MAX)) {
    s.keyboardOctave = raw.keyboardOctave;
  }
  if (EXPORT_FORMATS.includes(raw.exportFormat)) s.exportFormat = raw.exportFormat;
  if (typeof raw.metronome === 'boolean') s.metronome = raw.metronome;
  if (typeof raw.volumeNoticeDismissed === 'boolean') s.volumeNoticeDismissed = raw.volumeNoticeDismissed;
  return s;
}

let remember = true;
let current = null; // loaded on first read
let lastError = null;
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

function load() {
  if (current === null) {
    const result = readJson(SETTINGS_KEY, isSettings);
    current = Object.freeze(normalizeSettings(result.ok ? result.value : null));
  }
  return current;
}

/** Current settings (a frozen object that changes identity on every update). */
export function getSettings() {
  return load();
}

/** True while settings are remembered on this device. */
export function getRemember() {
  return remember;
}

/** The last settings write error (user-facing text), or null. */
export function getSettingsError() {
  return lastError;
}

/**
 * Merges `changes` into the settings and writes them when remembered.
 * Returns { ok: true } or { ok: false, error }; the in-memory settings change either way.
 */
export function updateSettings(changes) {
  current = Object.freeze(normalizeSettings({ ...load(), ...changes }));
  let result = { ok: true };
  if (remember) {
    const written = writeJson(SETTINGS_KEY, current);
    if (!written.ok) result = { ok: false, error: written.error.code === 'quota' ? STORAGE_FULL : STORAGE_UNAVAILABLE };
  }
  lastError = result.ok ? null : result.error;
  emit();
  return result;
}

/**
 * Turns "Remember settings on this device" on or off. Off removes the stored
 * settings and restores the volume notice; on writes the current settings.
 */
export function setRemember(on) {
  remember = on;
  if (on) return updateSettings({});
  removeKey(SETTINGS_KEY);
  current = Object.freeze({ ...load(), volumeNoticeDismissed: false });
  lastError = null;
  emit();
  return { ok: true };
}

/** Subscribes to settings changes. Returns an unsubscribe function. */
export function subscribeSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
