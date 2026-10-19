/*
 * Shape checks for stored JSON. Each returns true when the value has the
 * structure the readers rely on. They reject, they never repair: repairs belong
 * to migrate.js and the per-value normalizers.
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isInt = (v) => Number.isInteger(v);

/** Project IDs: "prj_" and 1 to 64 URL-safe characters, as createId() makes them. */
export const PROJECT_ID = /^prj_[A-Za-z0-9_-]{1,64}$/;

/** UTC timestamps as Date.prototype.toISOString() writes them. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** True for an ISO 8601 UTC timestamp naming a real instant. */
export function isIsoDate(v) {
  return isString(v) && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Project index: an array of { id, name, modifiedAt, archiveSavedAt,
 * archivedSources, bpm, timeSignature, trackCount, origin }; the list
 * metadata fields (bpm onward) are optional.
 */
export function isIndex(v) {
  return (
    Array.isArray(v) &&
    v.every((e) => isObject(e) && isString(e.id) && isString(e.name) && isString(e.modifiedAt))
  );
}

/**
 * Project document (docs/project-model.md): the fields every reader touches.
 * `id`, when given, must match the document's ID.
 */
export function isProjectDoc(v, id) {
  return (
    isObject(v) &&
    isInt(v.schemaVersion) &&
    isString(v.id) &&
    (id === undefined || v.id === id) &&
    isString(v.name) &&
    Array.isArray(v.tempo) &&
    v.tempo.length > 0 &&
    Array.isArray(v.meter) &&
    v.meter.length > 0 &&
    Array.isArray(v.trackOrder) &&
    isObject(v.tracks) &&
    isObject(v.clips) &&
    isObject(v.devices) &&
    isObject(v.sources) &&
    isString(v.masterTrackId) &&
    v.trackOrder.every((t) => isObject(v.tracks[t]))
  );
}

/**
 * Project document from outside this device (a .wrack file): a project
 * document whose ID can name a storage key and a URL path segment, with ISO
 * dates, positive finite tempos and positive integer meters, the fields the
 * project index and the list views take from it.
 */
export function isArchiveProject(v) {
  return (
    isProjectDoc(v) &&
    PROJECT_ID.test(v.id) &&
    isIsoDate(v.createdAt) &&
    isIsoDate(v.modifiedAt) &&
    v.tempo.every((t) => isObject(t) && isInt(t.tick) && t.tick >= 0 && Number.isFinite(t.bpm) && t.bpm > 0) &&
    v.meter.every((m) => isObject(m) && isInt(m.tick) && m.tick >= 0 && isInt(m.numerator) && m.numerator > 0 && isInt(m.denominator) && m.denominator > 0)
  );
}

/** Working state: an object; fields are checked one by one by view-state.js. */
export function isViewState(v) {
  return isObject(v);
}

/** Saved settings: an object; fields are checked one by one by the settings store. */
export function isSettings(v) {
  return isObject(v);
}
