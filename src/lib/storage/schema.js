/*
 * Shape checks for stored JSON. Each returns true when the value has the
 * structure the readers rely on. They reject, they never repair: repairs belong
 * to migrate.js and the per-value normalizers.
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isInt = (v) => Number.isInteger(v);

/** Project index: an array of { id, name, modifiedAt, archiveSavedAt }. */
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

/** Working state: an object; fields are checked one by one by view-state.js. */
export function isViewState(v) {
  return isObject(v);
}

/** Saved settings: an object; fields are checked one by one by the settings store. */
export function isSettings(v) {
  return isObject(v);
}
