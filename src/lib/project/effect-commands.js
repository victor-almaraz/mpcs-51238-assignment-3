/*
 * Insert-chain commands (assignment-3-scope.md, Effects). Pure functions from
 * a document to a new document. A track's chain is its effect devices: those
 * after the instrument on instrument tracks, all of them on audio tracks and
 * the master. Results are { ok: true, doc, ... } or { ok: false, error }.
 */
import { MAX_REVERBS } from '../../dsp/effects/reverb.js';
import { MAX_EFFECTS } from '../../dsp/protocol.js';
import { createDevice, createId } from './model.js';

const fail = (code, message) => ({ ok: false, error: { code, message } });

/** Index of the first chain entry in `track.deviceIds`. */
const chainStart = (track) => (track.kind === 'instrument' ? 1 : 0);

/** The chain's device IDs in order. */
export function chainIds(track) {
  return track.deviceIds.slice(chainStart(track));
}

function withChain(doc, track, ids) {
  const deviceIds = [...track.deviceIds.slice(0, chainStart(track)), ...ids];
  return { ...doc, tracks: { ...doc.tracks, [track.id]: { ...track, deviceIds } } };
}

/** Reverb devices in the project. */
export function reverbCount(doc) {
  return Object.values(doc.devices).filter((d) => d.type === 'reverb').length;
}

/** Why `type` cannot be added to `trackId`'s chain, or null. */
export function addEffectBlocker(doc, trackId, type) {
  const track = doc.tracks[trackId];
  if (!track) return 'No such track.';
  if (chainIds(track).length >= MAX_EFFECTS) return `A chain can hold at most ${MAX_EFFECTS} effects.`;
  if (type === 'reverb' && reverbCount(doc) >= MAX_REVERBS) return `A project can have at most ${MAX_REVERBS} reverbs.`;
  return null;
}

/** Appends an effect of `type` with default settings to the chain. Returns { ok, doc, deviceId }. */
export function addEffect(doc, trackId, type, makeId = createId) {
  const blocker = addEffectBlocker(doc, trackId, type);
  if (blocker) return fail('limit', blocker);
  const track = doc.tracks[trackId];
  const device = createDevice({ id: makeId('dev'), type });
  const next = withChain(doc, track, [...chainIds(track), device.id]);
  next.devices = { ...doc.devices, [device.id]: device };
  return { ok: true, doc: next, deviceId: device.id };
}

/** Removes effect `deviceId` from the chain and the document. */
export function removeEffect(doc, trackId, deviceId) {
  const track = doc.tracks[trackId];
  if (!track || !chainIds(track).includes(deviceId)) return fail('missing', 'No such effect.');
  const next = withChain(doc, track, chainIds(track).filter((id) => id !== deviceId));
  const { [deviceId]: _removed, ...devices } = doc.devices;
  return { ok: true, doc: { ...next, devices } };
}

/** Moves effect `deviceId` up (−1) or down (+1) the chain. */
export function moveEffect(doc, trackId, deviceId, dir) {
  const track = doc.tracks[trackId];
  const ids = track ? chainIds(track) : [];
  const at = ids.indexOf(deviceId);
  const to = at + dir;
  if (at < 0) return fail('missing', 'No such effect.');
  if (to < 0 || to >= ids.length) return fail('invalid', dir < 0 ? 'The effect is already first.' : 'The effect is already last.');
  [ids[at], ids[to]] = [ids[to], ids[at]];
  return { ok: true, doc: withChain(doc, track, ids), position: to + 1 };
}

/** Sets effect `deviceId`'s bypass. */
export function setEffectBypass(doc, deviceId, bypass) {
  const device = doc.devices[deviceId];
  if (!device) return fail('missing', 'No such effect.');
  return { ok: true, doc: { ...doc, devices: { ...doc.devices, [deviceId]: { ...device, bypass: Boolean(bypass) } } } };
}
