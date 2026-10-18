/*
 * The preset library (assignment-3-scope.md, Presets) at wrack:v1:presets:
 * { schema: 1, presets: [...] }, shared by every project and never stored in
 * project JSON. Reads normalize and clamp (validate.js). Writes return
 * { ok: true, ... } or { ok: false, error } with user-facing text.
 */
import { createId } from '../project/model.js';
import { STORAGE_FULL, STORAGE_UNAVAILABLE } from '../project/store.js';
import { PRESETS_KEY } from '../storage/keys.js';
import { readJson, readRaw, subscribe, writeJson } from '../storage/storage.js';
import { LIBRARY_FULL, MAX_PRESETS, normalizeLibrary, normalizePreset, presetNameError } from './validate.js';

export const PRESETS_SCHEMA = 1;

let cachedRaw;
let cached = [];

/** Every preset in the library (a cached array; identity changes when storage does). */
export function getPresets() {
  const raw = readRaw(PRESETS_KEY);
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  const result = readJson(PRESETS_KEY);
  cached = Object.freeze(result.ok ? normalizeLibrary(result.value) : []);
  return cached;
}

/** Subscribes to library changes (this tab and others). Returns an unsubscribe function. */
export const subscribePresets = subscribe;

/** Presets of `type`, in saved order. */
export function presetsOfType(type) {
  return getPresets().filter((p) => p.type === type);
}

function write(presets) {
  const result = writeJson(PRESETS_KEY, { schema: PRESETS_SCHEMA, presets });
  if (result.ok) return result;
  return { ok: false, error: { message: result.error.code === 'quota' ? STORAGE_FULL : STORAGE_UNAVAILABLE } };
}

/**
 * Saves a preset { name, kind, type, typeLabel, params, sampler? }. Errors:
 * { field: 'name', message } for the name rules, { message } for a full
 * library or storage. Returns { ok, preset } on success.
 */
export function savePreset({ name, kind, type, typeLabel, params, sampler }, { now = new Date().toISOString(), makeId = createId } = {}) {
  const presets = getPresets();
  const nameError = presetNameError(name, { type, typeLabel, presets });
  if (nameError) return { ok: false, error: { field: 'name', message: nameError } };
  if (presets.length >= MAX_PRESETS) return { ok: false, error: { message: LIBRARY_FULL } };
  const preset = normalizePreset({ id: makeId('pst'), name, kind, type, params, sampler, createdAt: now });
  if (!preset) return { ok: false, error: { message: 'This device cannot be saved as a preset.' } };
  const written = write([...presets, preset]);
  return written.ok ? { ok: true, preset } : written;
}

/** Renames preset `id` under the same name rules. */
export function renamePreset(id, name, typeLabel) {
  const presets = getPresets();
  const preset = presets.find((p) => p.id === id);
  if (!preset) return { ok: false, error: { message: 'This preset no longer exists.' } };
  const nameError = presetNameError(name, { type: preset.type, typeLabel, presets, exceptId: id });
  if (nameError) return { ok: false, error: { field: 'name', message: nameError } };
  return write(presets.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)));
}

/**
 * The device's preset for display: its name, "<name> (edited)" once its
 * parameters differ from the library preset, or null without one.
 */
export function presetLabel(device) {
  if (!device.preset) return null;
  const preset = getPresets().find((p) => p.id === device.preset.id);
  if (!preset) return device.preset.name;
  const edited = Object.entries(preset.params).some(([id, v]) => device.params[id] !== undefined && device.params[id] !== v);
  return edited ? `${preset.name} (edited)` : preset.name;
}

/** Deletes preset `id`. */
export function deletePreset(id) {
  return write(getPresets().filter((p) => p.id !== id));
}

/**
 * Returns `doc` with device `deviceId` set to `preset` (parameters replaced;
 * a sampler preset's zone too) and `device.preset` recording { id, name }.
 * `preset` null applies the built-in defaults.
 */
export function applyPreset(doc, deviceId, preset) {
  const device = doc.devices[deviceId];
  if (!device) return doc;
  const next = { ...device, params: preset ? { ...preset.params } : {}, preset: preset ? { id: preset.id, name: preset.name } : null };
  if (device.type === 'sampler' && preset?.sampler) next.sampler = { ...preset.sampler };
  return { ...doc, devices: { ...doc.devices, [deviceId]: next } };
}
