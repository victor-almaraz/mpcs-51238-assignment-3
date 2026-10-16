/*
 * Detects edits that change only mixer and instrument parameters, so the
 * engine client can send a `params` message instead of recompiling the model.
 * Documents are immutable with structural sharing, so unchanged parts compare
 * by reference.
 */
import { clampParam } from '../../dsp/core/params.js';
import {
  EFFECT_BYPASS,
  EFFECT_PARAM_BASE,
  EFFECT_PARAM_STRIDE,
  INSTRUMENT_PARAM_BASE,
  MASTER_TARGET,
  PARAM_GAIN,
  PARAM_MUTE,
  PARAM_PAN,
  PARAM_SOLO,
} from '../../dsp/engine/engine.js';
import { instrumentFor } from '../../dsp/instruments/registry.js';
import { PAN, TRACK_GAIN } from '../../dsp/mixer/mixer.js';
import { effectFor } from '../../dsp/effects/registry.js';
import { effectDevices } from './compile-model.js';

/**
 * Pushes [target, paramId, value] for each effect parameter and bypass that
 * differs between the chains of `pt` and `nt` (the same device IDs), or
 * returns false when an effect changed type (a full model is needed).
 */
function effectChanges(prev, next, pt, nt, target, out) {
  const before = effectDevices(prev, pt);
  const after = effectDevices(next, nt);
  if (before.length !== after.length) return false;
  for (let s = 0; s < after.length; s++) {
    const pd = before[s];
    const nd = after[s];
    if (pd === nd) continue;
    if (pd.id !== nd.id || pd.type !== nd.type) return false;
    const base = EFFECT_PARAM_BASE + EFFECT_PARAM_STRIDE * s;
    if ((pd.bypass === true) !== (nd.bypass === true)) out.push(target, base + EFFECT_BYPASS, nd.bypass ? 1 : 0);
    effectFor(nd.type).params.forEach((def, k) => {
      if (pd.params[def.id] !== nd.params[def.id]) out.push(target, base + k, clampParam(def, nd.params[def.id]));
    });
  }
  return true;
}

/** Instrument and audio track IDs in compile order (the engine's track indices). */
export function engineTrackIds(doc) {
  return doc.trackOrder.filter((id) => {
    const track = doc.tracks[id];
    return track?.kind === 'audio' || (track?.kind === 'instrument' && doc.devices[track.deviceIds[0]]);
  });
}

/**
 * Returns [target, paramId, value, …] for the parameter differences from
 * `prev` to `next`, or null when anything else changed (a full model is
 * needed). An empty array means no audible change.
 */
export function paramChanges(prev, next) {
  if (!prev || prev.id !== next.id) return null;
  for (const key of ['clips', 'tempo', 'meter', 'trackOrder', 'loop', 'sources', 'audioRate', 'masterTrackId']) {
    if (prev[key] !== next[key]) return null;
  }
  const out = [];
  const ids = engineTrackIds(next);
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    const pt = prev.tracks[id];
    const nt = next.tracks[id];
    if (!pt || pt.deviceIds !== nt.deviceIds || pt.clipIds !== nt.clipIds || pt.kind !== nt.kind) return null;
    if (pt.gainDb !== nt.gainDb) out.push(index, PARAM_GAIN, clampParam(TRACK_GAIN, nt.gainDb));
    if (pt.pan !== nt.pan) out.push(index, PARAM_PAN, clampParam(PAN, nt.pan));
    if (pt.mute !== nt.mute) out.push(index, PARAM_MUTE, nt.mute ? 1 : 0);
    if (pt.solo !== nt.solo) out.push(index, PARAM_SOLO, nt.solo ? 1 : 0);
    if (!effectChanges(prev, next, pt, nt, index, out)) return null;
    if (nt.kind !== 'instrument') continue;
    const deviceId = nt.deviceIds[0];
    const pd = prev.devices[deviceId];
    const nd = next.devices[deviceId];
    if (pd === nd) continue;
    if (!pd || pd.type !== nd.type) return null;
    const entry = instrumentFor(nd.type);
    if (!entry) continue;
    entry.params.forEach((def, i) => {
      if (pd.params[def.id] !== nd.params[def.id]) out.push(index, INSTRUMENT_PARAM_BASE + i, clampParam(def, nd.params[def.id]));
    });
  }
  const pm = prev.tracks[prev.masterTrackId];
  const nm = next.tracks[next.masterTrackId];
  if (pm.deviceIds !== nm.deviceIds) return null;
  if (pm.pan !== nm.pan) out.push(MASTER_TARGET, PARAM_PAN, clampParam(PAN, nm.pan));
  if (!effectChanges(prev, next, pm, nm, MASTER_TARGET, out)) return null;
  return out;
}
