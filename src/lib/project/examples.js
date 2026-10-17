/*
 * Example projects (assignment-3-scope.md, Examples). MIDI-only documents with
 * fixed IDs and timestamps, so they are identical on every visit. Opening one
 * creates a copy (store.js); these documents never change.
 *
 * Instrument types: subtractive, fm, additive, pluck, granular, drums.
 * Effect types: eq3, filter, compressor, saturation, distortion, delay, reverb.
 * Device params hold only overrides; every other parameter takes its default.
 */
import { createDevice, createDocument, createTrack, ticksPerBar } from './model.js';
import { PPQ } from '../../dsp/core/constants.js';

const EXAMPLE_TIME = '2026-01-01T00:00:00.000Z';
const STEP = PPQ / 4; // one sixteenth note, in ticks

/**
 * Builds notes from [step, pitch, lengthInSteps, velocity] rows.
 * Steps are sixteenth notes from the clip start.
 */
function notes(prefix, rows) {
  return rows.map(([step, pitch, steps, velocity], i) => ({
    id: `nte_${prefix}-${i}`,
    tick: step * STEP,
    length: steps * STEP,
    pitch,
    velocity,
    channel: 0,
  }));
}

/** Repeats `rows` every `everySteps` steps, `times` times. */
function repeat(rows, everySteps, times) {
  const out = [];
  for (let t = 0; t < times; t++) for (const [step, ...rest] of rows) out.push([step + t * everySteps, ...rest]);
  return out;
}

/**
 * Builds one example document from track specs:
 * { key, name, color, instrument, effects, notes, bars }.
 */
function buildExample({ slug, name, tempo, tracks, masterEffects = [] }) {
  const masterTrackId = `trk_${slug}-master`;
  const masterDevices = masterEffects.map((type, i) => createDevice({ id: `dev_${slug}-master-${i}`, type }));
  const doc = createDocument({
    id: `prj_example-${slug}`,
    name,
    tempo,
    timeSignature: '4/4',
    now: EXAMPLE_TIME,
    masterTrackId,
    masterDevices,
  });
  const bar = ticksPerBar(4, 4);
  for (const spec of tracks) {
    const trackId = `trk_${slug}-${spec.key}`;
    const clipId = `clp_${slug}-${spec.key}`;
    const devices = [spec.instrument, ...(spec.effects ?? [])].map((type, i) =>
      createDevice({ id: `dev_${slug}-${spec.key}-${i}`, type }),
    );
    doc.trackOrder.push(trackId);
    doc.tracks[trackId] = createTrack({
      id: trackId,
      kind: 'instrument',
      name: spec.name,
      color: spec.color,
      deviceIds: devices.map((d) => d.id),
      output: masterTrackId,
      clipIds: [clipId],
    });
    for (const d of devices) doc.devices[d.id] = d;
    doc.clips[clipId] = {
      id: clipId,
      trackId,
      kind: 'midi',
      start: 0,
      length: spec.bars * bar,
      name: spec.name,
      muted: false,
      notes: notes(`${slug}-${spec.key}`, spec.notes),
    };
  }
  doc.loop = { start: 0, end: Math.max(...tracks.map((t) => t.bars)) * bar };
  return doc;
}

const KICK = 36;
const SNARE = 38;
const CLOSED_HAT = 42;
const OPEN_HAT = 46;
const CRASH = 49;

const beat = buildExample({
  slug: 'beat',
  name: 'Beat',
  tempo: 100,
  tracks: [
    {
      key: 'drums',
      name: 'Drums',
      color: '#c51e21',
      instrument: 'drums',
      effects: ['compressor'],
      bars: 2,
      notes: [
        [0, CRASH, 1, 100],
        ...repeat([[0, KICK, 1, 120], [8, KICK, 1, 110], [4, SNARE, 1, 112], [12, SNARE, 1, 112]], 16, 2),
        [10, KICK, 1, 96],
        [26, KICK, 1, 96],
        ...repeat([[0, CLOSED_HAT, 1, 80], [2, CLOSED_HAT, 1, 64], [4, CLOSED_HAT, 1, 80], [6, CLOSED_HAT, 1, 64],
          [8, CLOSED_HAT, 1, 80], [10, CLOSED_HAT, 1, 64], [12, CLOSED_HAT, 1, 80], [14, OPEN_HAT, 1, 72]], 16, 2),
      ],
    },
    {
      key: 'bass',
      name: 'Bass',
      color: '#1659b5',
      instrument: 'subtractive',
      effects: ['saturation'],
      bars: 2,
      notes: [
        [0, 33, 2, 110], [3, 33, 2, 96], [6, 36, 2, 100], [8, 33, 3, 110], [12, 31, 3, 100],
        [16, 29, 2, 110], [19, 29, 2, 96], [22, 33, 2, 100], [24, 29, 3, 110], [28, 31, 3, 100],
      ],
    },
    {
      key: 'stab',
      name: 'Lead stab',
      color: '#895709',
      instrument: 'fm',
      effects: ['distortion'],
      bars: 2,
      notes: [
        [2, 69, 1, 96], [2, 72, 1, 96], [2, 76, 1, 96],
        [10, 69, 1, 88], [10, 72, 1, 88], [10, 76, 1, 88],
        [18, 65, 1, 96], [18, 69, 1, 96], [18, 72, 1, 96],
        [26, 67, 1, 88], [26, 71, 1, 88], [26, 74, 1, 88],
      ],
    },
  ],
});

const ambient = buildExample({
  slug: 'ambient',
  name: 'Ambient',
  tempo: 72,
  tracks: [
    {
      key: 'texture',
      name: 'Texture',
      color: '#1d6835',
      instrument: 'granular',
      effects: ['filter', 'reverb'],
      bars: 4,
      notes: [[0, 45, 32, 80], [0, 52, 32, 72], [32, 41, 32, 80], [32, 48, 32, 72]],
    },
    {
      key: 'pad',
      name: 'Pad',
      color: '#1659b5',
      instrument: 'additive',
      effects: ['delay'],
      bars: 4,
      notes: [
        [0, 57, 32, 70], [0, 60, 32, 66], [0, 64, 32, 66],
        [32, 53, 32, 70], [32, 57, 32, 66], [32, 60, 32, 66],
      ],
    },
  ],
});

const pluckMelody = buildExample({
  slug: 'pluck',
  name: 'Pluck melody',
  tempo: 110,
  masterEffects: ['eq3'],
  tracks: [
    {
      key: 'lead',
      name: 'Pluck lead',
      color: '#e36927',
      instrument: 'pluck',
      effects: ['delay'],
      bars: 2,
      notes: [
        [0, 76, 2, 100], [2, 74, 2, 92], [4, 72, 2, 96], [6, 74, 2, 92],
        [8, 76, 2, 100], [10, 76, 2, 96], [12, 76, 4, 100],
        [16, 74, 2, 96], [18, 74, 2, 92], [20, 74, 4, 96], [24, 76, 2, 100], [26, 79, 2, 96], [28, 79, 4, 100],
      ],
    },
    {
      key: 'bass',
      name: 'Bass',
      color: '#1659b5',
      instrument: 'subtractive',
      bars: 2,
      notes: [[0, 36, 8, 100], [8, 36, 8, 92], [16, 31, 8, 100], [24, 31, 8, 92]],
    },
  ],
});

/** Example cards in display order. `slug` appears in the ?example= query of an opened copy. */
export const EXAMPLES = [
  { slug: 'beat', title: 'Beat', description: 'Drum machine, subtractive bass and an FM lead stab.', doc: beat },
  { slug: 'ambient', title: 'Ambient', description: 'Granular texture and an additive pad with reverb and delay.', doc: ambient },
  { slug: 'pluck', title: 'Pluck melody', description: 'A plucked-string melody with delay over a subtractive bass.', doc: pluckMelody },
];

/** Returns the example with `slug`, or undefined. */
export function findExample(slug) {
  return EXAMPLES.find((e) => e.slug === slug);
}
