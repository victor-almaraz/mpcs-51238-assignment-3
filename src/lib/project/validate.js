/*
 * New project form validation. Each validator returns null for a valid value or
 * the exact error text from docs/assignment-3-scope.md (New project form).
 */
import { NAME_MAX, TEMPO_MAX, TEMPO_MIN, parseTimeSignature } from './model.js';

export const NAME_EMPTY = 'Enter a project name.';
export const NAME_TOO_LONG = `Use ${NAME_MAX} characters or fewer.`;
export const TEMPO_INVALID = `Enter a tempo between ${TEMPO_MIN} and ${TEMPO_MAX}.`;

/** Validates a raw project name: 1–60 characters (code points) after trimming. */
export function validateProjectName(raw) {
  const name = String(raw ?? '').trim();
  if (name.length === 0) return NAME_EMPTY;
  if ([...name].length > NAME_MAX) return NAME_TOO_LONG;
  return null;
}

/** Parses a raw tempo string as an integer BPM, or returns null when it is not one. */
export function parseTempo(raw) {
  const text = String(raw ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** Validates a raw tempo: an integer from 40 to 240. */
export function validateTempo(raw) {
  const bpm = parseTempo(raw);
  return bpm !== null && bpm >= TEMPO_MIN && bpm <= TEMPO_MAX ? null : TEMPO_INVALID;
}

/** Validates a time signature form value. Values the selects cannot produce are programming errors. */
export function validateTimeSignature(value) {
  if (!parseTimeSignature(value)) throw new Error(`Unknown time signature: ${value}`);
  return null;
}

/**
 * Validates the whole form. Returns { ok: true, value } with a trimmed name and
 * integer tempo, or { ok: false, errors } keyed by field name.
 */
export function validateNewProject({ name, tempo, timeSignature }) {
  validateTimeSignature(timeSignature);
  const errors = {};
  const nameError = validateProjectName(name);
  const tempoError = validateTempo(tempo);
  if (nameError) errors.name = nameError;
  if (tempoError) errors.tempo = tempoError;
  if (nameError || tempoError) return { ok: false, errors };
  return { ok: true, value: { name: String(name).trim(), tempo: parseTempo(tempo), timeSignature } };
}
