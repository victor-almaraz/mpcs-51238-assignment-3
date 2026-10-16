/*
 * Preset validation (assignment-3-scope.md, Presets). A preset is
 * { id, name, kind: 'instrument' | 'effect', type, params, sampler?, createdAt }.
 * Parameters are clamped through the type's ParamDefs whenever a preset is
 * read, so stored values never reach a device unclamped. Sampler presets keep
 * their zone as { sourceId, sourceName }, never audio.
 */
import { clampParams } from '../../dsp/core/params.js';
import { effectFor } from '../../dsp/effects/registry.js';
import { instrumentFor } from '../../dsp/instruments/registry.js';

/** Library size and name length limits (project limits). */
export const MAX_PRESETS = 200;
export const MAX_PRESET_NAME = 40;

export const NAME_REQUIRED = 'Enter a preset name.';
export const NAME_TOO_LONG = `Use ${MAX_PRESET_NAME} characters or fewer.`;
export const nameTaken = (typeLabel) => `A preset with this name already exists for ${typeLabel}. Choose another name.`;
export const LIBRARY_FULL = 'The preset library is full. Delete a preset in Settings to save a new one.';

/** The ParamDefs of preset kind and type, or null for unknown types. */
export function paramDefsFor(kind, type) {
  const entry = kind === 'effect' ? effectFor(type) : kind === 'instrument' ? instrumentFor(type) : undefined;
  return entry ? entry.params : null;
}

/** Name compared for uniqueness: trimmed and case-folded. */
const nameKey = (name) => name.trim().toLocaleLowerCase();

/**
 * The error text for preset name `name` of `type` among `presets`, or null.
 * `exceptId` skips the preset being renamed; `typeLabel` names the type in
 * the duplicate message ("Subtractive synth").
 */
export function presetNameError(name, { type, typeLabel, presets, exceptId = null }) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return NAME_REQUIRED;
  if ([...trimmed].length > MAX_PRESET_NAME) return NAME_TOO_LONG;
  const key = nameKey(trimmed);
  if (presets.some((p) => p.type === type && p.id !== exceptId && nameKey(p.name) === key)) return nameTaken(typeLabel);
  return null;
}

/** A valid, clamped copy of stored preset `raw`, or null when it cannot be used. */
export function normalizePreset(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const { id, name, kind, type } = raw;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof type !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > MAX_PRESET_NAME) return null;
  const defs = paramDefsFor(kind, type);
  if (!defs) return null;
  const params = clampParams(defs, raw.params && typeof raw.params === 'object' ? raw.params : {});
  const preset = { id, name: trimmed, kind, type, params, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '' };
  const z = raw.sampler;
  if (type === 'sampler' && z && typeof z.sourceId === 'string' && typeof z.sourceName === 'string') {
    preset.sampler = { sourceId: z.sourceId, sourceName: z.sourceName };
  }
  return preset;
}

/** The usable presets of stored library `raw` ({ presets: [] }), first 200, unique IDs. */
export function normalizeLibrary(raw) {
  const list = Array.isArray(raw?.presets) ? raw.presets : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const preset = normalizePreset(item);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    out.push(preset);
    if (out.length === MAX_PRESETS) break;
  }
  return out;
}
