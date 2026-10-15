/*
 * Project documents (docs/project-model.md): pure constructors and constants.
 * No storage or browser access; IDs take their randomness from an injectable source.
 */
import { PPQ } from '../../dsp/core/constants.js';

/** Version of the project JSON written by this build. */
export const SCHEMA_VERSION = 1;

/** Project name length limit, in characters after trimming. */
export const NAME_MAX = 60;

/** Tempo limits for new projects, in integer BPM. */
export const TEMPO_MIN = 40;
export const TEMPO_MAX = 240;
export const DEFAULT_TEMPO = 120;

/** Time signatures offered for new projects. `value` is the form value. */
export const TIME_SIGNATURES = [
  { value: '2/4', numerator: 2, denominator: 4 },
  { value: '3/4', numerator: 3, denominator: 4 },
  { value: '4/4', numerator: 4, denominator: 4 },
  { value: '6/8', numerator: 6, denominator: 8 },
];
export const DEFAULT_TIME_SIGNATURE = '4/4';

/** Master volume default, in dB (assignment-3-scope.md, Mixer). */
export const MASTER_GAIN_DB = -12;

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const ID_LENGTH = 21;

/**
 * Returns a new ID: `prefix`, an underscore and 21 URL-safe random characters.
 * `randomBytes(n)` returns a Uint8Array of n random bytes; it defaults to
 * crypto.getRandomValues.
 */
export function createId(prefix, randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = randomBytes(ID_LENGTH);
  let suffix = '';
  for (let i = 0; i < ID_LENGTH; i++) suffix += ID_ALPHABET[bytes[i] & 63];
  return `${prefix}_${suffix}`;
}

/** Returns "Untitled project N" for the lowest N ≥ 1 not used by `existingNames`. */
export function nextUntitledName(existingNames) {
  const used = new Set(existingNames);
  let n = 1;
  while (used.has(`Untitled project ${n}`)) n++;
  return `Untitled project ${n}`;
}

/** Ticks in one bar of `numerator`/`denominator` time. */
export function ticksPerBar(numerator, denominator) {
  return (numerator * 4 * PPQ) / denominator;
}

/**
 * Returns a track with mixer defaults: 0 dB gain, centre pan, no mute or solo.
 * `output` is the master track ID, or null for the master itself.
 */
export function createTrack({ id, kind, name, color, deviceIds = [], output, clipIds = [], gainDb = 0 }) {
  return {
    id,
    kind,
    name,
    color,
    deviceIds,
    output,
    gainDb,
    pan: 0,
    mute: false,
    solo: false,
    soloSafe: false,
    armed: false,
    sendIds: [],
    laneIds: [],
    clipIds,
  };
}

/** Returns a built-in device of `type` with `params` overriding its defaults. */
export function createDevice({ id, type, params = {} }) {
  return { id, kind: 'builtin', type, bypass: false, params };
}

/**
 * Returns an empty document shell with a master bus.
 * `now` is an ISO 8601 timestamp; `tempo` in BPM; `timeSignature` a TIME_SIGNATURES value.
 */
export function createDocument({ id, name, tempo, timeSignature, now, masterTrackId, masterDevices = [] }) {
  const sig = TIME_SIGNATURES.find((s) => s.value === timeSignature);
  if (!sig) throw new Error(`Unknown time signature: ${timeSignature}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    modifiedAt: now,
    tempo: [{ tick: 0, bpm: tempo, shape: 'step' }],
    meter: [{ tick: 0, numerator: sig.numerator, denominator: sig.denominator }],
    trackOrder: [],
    tracks: {
      [masterTrackId]: createTrack({
        id: masterTrackId,
        kind: 'bus',
        name: 'Master',
        color: '#1e201a',
        deviceIds: masterDevices.map((d) => d.id),
        output: null,
        gainDb: MASTER_GAIN_DB,
      }),
    },
    clips: {},
    sources: {},
    devices: Object.fromEntries(masterDevices.map((d) => [d.id, d])),
    lanes: {},
    sends: {},
    masterTrackId,
    markers: [],
    loop: null,
    punch: null,
    extensions: {},
  };
}

/**
 * Returns a new project from New project form values: a master bus and one
 * empty instrument track playing the subtractive synth.
 */
export function createProject({ name, tempo, timeSignature, now, makeId = createId }) {
  const masterTrackId = makeId('trk');
  const doc = createDocument({ id: makeId('prj'), name, tempo, timeSignature, now, masterTrackId });
  const device = createDevice({ id: makeId('dev'), type: 'subtractive' });
  const track = createTrack({
    id: makeId('trk'),
    kind: 'instrument',
    name: 'Track 1',
    color: '#e36927',
    deviceIds: [device.id],
    output: masterTrackId,
  });
  return {
    ...doc,
    trackOrder: [track.id],
    tracks: { ...doc.tracks, [track.id]: track },
    devices: { ...doc.devices, [device.id]: device },
  };
}

/**
 * Returns a copy of `doc` with a new project ID, name and timestamps. Entity IDs
 * inside the document are kept: they are unique within a project.
 */
export function copyDocument(doc, { id, name, now }) {
  return { ...structuredClone(doc), id, name, createdAt: now, modifiedAt: now };
}

/** Display names of built-in instrument types, used in track names. */
export const INSTRUMENT_LABELS = {
  subtractive: 'Subtractive synth',
  fm: 'FM synth',
  additive: 'Additive synth',
  pluck: 'Pluck synth',
  granular: 'Granular synth',
  drums: 'Drum machine',
  sampler: 'Sampler',
};

/** Accessible track name: "Track 2: Bass, FM synth". `position` is 1-based. */
export function trackLabel(doc, trackId, position) {
  const track = doc.tracks[trackId];
  const instrument = track.kind === 'instrument' ? doc.devices[track.deviceIds[0]] : null;
  const kind = instrument ? (INSTRUMENT_LABELS[instrument.type] ?? instrument.type) : 'Audio';
  return `Track ${position}: ${track.name}, ${kind}`;
}

/** Returns `doc` with a constant tempo of `bpm` (the transport edits the first tempo point only). */
export function setTempo(doc, bpm) {
  return { ...doc, tempo: [{ ...doc.tempo[0], bpm }, ...doc.tempo.slice(1)] };
}

/** Returns `doc` with time signature `value` (a TIME_SIGNATURES value) from bar 1. */
export function setTimeSignature(doc, value) {
  const sig = TIME_SIGNATURES.find((s) => s.value === value);
  if (!sig) throw new Error(`Unknown time signature: ${value}`);
  return { ...doc, meter: [{ tick: 0, numerator: sig.numerator, denominator: sig.denominator }] };
}
