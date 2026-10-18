# Instruments

## Common rules
- Pitch: f = 440·2^((p − 69)/12).
- Velocity gain: 0.3·(vel/127)².
- All randomness uses a seeded mulberry32 PRNG. Each kernel's seed derives from the project seed and the track index; each note seeds its noise from the kernel seed and the note's index in the track's expanded note list. Renders are therefore reproducible.
- Voice limits and polyphony auto-gain: `audio-safety.md`.

## Kernel interface
Instrument kernels are JavaScript classes in `src/dsp/instruments/`, registered by device type in `registry.js` as `{ params, Kernel }`. The main thread and the worklet share the registry.

```ts
export interface InstrumentKernel {
  constructor(fs: number, global: GlobalVoices);    // allocates every buffer; `global` is the engine's shared voice budget
  readonly stereo?: true;                           // drum machine and sampler render stereo; the others render mono
  seed: number;                                     // set by the engine from the project seed and track index
  setParam(id: string, plainValue: number): void;   // clamps through the ParamDef
  noteOn(noteId: number, pitch: number, velocity: number): void;
  noteOff(noteId: number): void;
  releaseSequenced(): void;                         // releases sequenced notes; live notes keep sounding
  allNotesOff(hard: boolean): void;                 // hard: 64-frame fade instead of release
  activeVoices(): number;
  render(out: Float32Array, start: number, end: number): void;                       // mono kernels
  render(outL: Float32Array, outR: Float32Array, start: number, end: number): void;  // stereo kernels
}
```
- `render` overwrites frames `[start, end)`. The engine renders up to each event's frame and then applies the event, so events take effect at their exact frame.
- Sequenced notes use their index in the track's expanded note list as `noteId`; live notes use IDs from `LIVE_NOTE_BASE` (2^24) upward.
- Only the constructor and source binding allocate.

## Synth envelopes and tuning
Subtractive, FM and additive use an ADSR envelope: a linear attack to the peak, a decay toward the sustain level (−80 dB of the distance over the decay time), a hold at sustain, and an exponential release to −80 dB over the release time. Sustain 1 holds the peak. With sustain 0, a held note ends once the decay dies away.

| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| decay | 0.01–4 | per instrument | s | pow3 |
| sustain | 0–1 | 1 | — | lin |

Every synth (subtractive, FM, additive, pluck, granular) ends its parameter list with the Tuning group. Notes that start after a change sound 12·octave + cents/100 semitones away; the shifted pitch is clamped to MIDI 0–127.

| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| octave | −3 to 3, step 1 | 0 | oct | lin |
| cents | −100 to 100, step 1 | 0 | cents | lin |

## Subtractive
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| waveform | sine, square, saw, triangle | saw | — | enum |
| cutoff | 40–16 000 (≤ 0.45·fs) | 2000 | Hz | log |
| resonance | 0–20 | 1 | dB | lin |
| envAmount (Filter env) | 0–6, step 0.1 | 0 | oct | lin |
| attack | 0.002–2 | 0.01 | s | pow3 |
| decay | 0.01–4 | 0.3 | s | pow3 |
| sustain | 0–1 | 1 | — | lin |
| release | 0.01–4 | 0.3 | s | pow3 |

- Square, saw and triangle are band-limited.
- The filter envelope follows the amplitude envelope's shape: the cutoff rises by envAmount octaves at the peak and by sustain·envAmount while held.
- The depth is fixed per voice at note-on and capped so that cutoff·2^depth ≤ 0.45·fs. While the cutoff knob is above 0.45·fs/2^depth, the voice's base cutoff is lowered to fit.
- Voices with a filter envelope recompute their filter coefficients every 16 frames.

## FM (two-operator)
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| ratio | 0.5–12, step 0.5 | 2 | × carrier | lin |
| fine | −0.5 to 0.5, step 0.01 | 0 | offset | lin |
| index | 0–20 | 3 | — | lin |
| indexDecay | 0.01–4 | 0.5 | s | pow3 |
| attack | 0.002–2 | 0.005 | s | pow3 |
| decay | 0.01–4 | 0.5 | s | pow3 |
| sustain | 0–1 | 1 | — | lin |
| release | 0.01–4 | 0.4 | s | pow3 |

- The modulator runs at f_m = (ratio + fine)·f_c, at least 0.01·f_c; fine moves it off the ratio grid for inharmonic, bell-like spectra. Ratio and fine apply to notes that start after a change.
- Peak frequency deviation = I·f_m.
- Nyquist clamp: I_max = max(0, (0.45·fs − f_c)/f_m − 1).

## Additive
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| h1–h8 | 0–1 each | 1, .5, .33, .25, .2, .17, .14, .12 | — | lin |
| attack | 0.002–2 | 0.02 | s | pow3 |
| decay | 0.01–4 | 0.5 | s | pow3 |
| sustain | 0–1 | 1 | — | lin |
| release | 0.01–4 | 0.5 | s | pow3 |
| vibratoRate | 0.5–12 | 5 | Hz | log |
| vibratoDepth (Vibrato) | 0–100, step 1 | 0 | cents | lin |

- Output is divided by max(1, Σh). Harmonics above 0.45·fs at note-on are omitted.
- Vibrato is a per-voice sine LFO that starts at phase 0 on note-on and moves the pitch by up to ±depth cents; it never changes the level. At +100 cents the highest kept harmonic stays below 0.48·fs.

## Pluck (Karplus-Strong)
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| damping | 0–1 | 0.5 | — | lin |
| brightness | 0–1 | 0.7 | — | lin |
| pickPosition | 0–0.5, step 0.01 | 0 | fraction of the string | lin |
| decay (T60) | 0.2–10 | 2 | s | pow3 |
| release | 0.02–2 | 0.1 | s | pow3 |

- Loop gain ρ = 10^(−3/(T60·f)), capped at 0.9999; total loop gain < 1 at all frequencies.
- Fractional delay: first-order allpass, C = (1 − d)/(1 + d), d ∈ [0.1, 1.1).
- Excitation is seeded noise through a one-pole lowpass set by brightness. Pick position applies the comb 1 − z^−k, k = round(pickPosition·N), circularly over the period, so harmonics with a node at the pick point are removed. Pick position 0 applies no comb.
- Note-off mutes the string: the loop gain glides (τ = 5 ms) to the gain for T60 = release, never above the decay's gain.
- A voice ends when one pass round the loop peaks below 1e-6, whether the note is held or released.
- Output passes a DC blocker.

## Granular
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| source | saw, noise, chord (generated), File (`sample`) | saw | — | enum |
| position | 0–1 | 0.5 | — | lin |
| grainSize | 0.01–0.25 | 0.06 | s | log |
| density | 2–60 | 20 | grains/s | log |
| spray | 0–1 | 0.2 | — | lin |
| pitchSpread | 0–1200, step 1 | 0 | cents | lin |
| attack | 0.002–2 | 0.05 | s | pow3 |
| release | 0.01–4 | 0.4 | s | pow3 |

- ≤ 4 voices and ≤ 64 concurrent grains (project limits). Generated source buffers (2 s) are built at construction.
- Grains read at rate f/261.63 (noise: 1). Pitch spread detunes each grain by a random amount within ±pitchSpread cents; noise grains are not detuned.
- A grain covers c = grainSize·rate source frames. It starts at position·(L − c) + spray·(rand − 0.5)·L, clamped to [0, L − c].
- The File source is an audio file stored on the device as `device.granular = { sourceId, sourceName }`. It binds through the same `sampler-zones` path as the sampler. Grains read the mean of its channels over its first 20 s. Without a loaded file, File is silent and the panel shows "Audio not loaded: <name>".
- Each voice has an attack-release envelope.

## Drum machine
Fourteen synthesized voices; no samples. Notes map through the General MIDI Level 1 percussion key map.

```ts
type DrumVoiceId =
  | "kick" | "snare" | "sidestick" | "clap" | "closedHat" | "pedalHat" | "openHat"
  | "lowTom" | "midTom" | "highTom" | "crash" | "ride" | "cowbell" | "claves";
export interface DrumMapEntry { note: number; voice: DrumVoiceId; tuneOffset: number; gmName: string }
```

| Note | Voice | Note | Voice | Note | Voice |
|---|---|---|---|---|---|
| 35, 36 | kick | 41, 43 | lowTom | 49, 57 | crash |
| 37 | sidestick | 42 | closedHat | 51, 59 | ride |
| 38, 40 | snare | 44 | pedalHat | 56 | cowbell |
| 39 | clap | 45, 47 | midTom | 75 | claves |
| 46 | openHat | 48, 50 | highTom | | |

Parameter IDs are `<voiceId>.<param>` and `kit.<param>`; 14 × 5 + 3 = 73 parameters.

| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| `kit.level` | −60 to +6 | 0 | dB | lin |
| `kit.velSens` | 0–1 | 1 | — | lin |
| `kit.choke` | off, on | on | — | enum |
| `<voice>.level` | −60 to +6 | 0 | dB | lin |
| `<voice>.tune` | −12 to +12, step 0.1 | 0 | semitones | lin |
| `<voice>.decay` | 0.1–4 | 1 | × base T60 | log |
| `<voice>.tone` | 0–1 | 0.5 | — | lin |
| `<voice>.pan` | −1 to +1 | 0 | — | lin |

- Unmapped notes are silent. Note-off has no effect; hits end when their envelope falls below 1e-4.
- Each voice is monophonic except crash and ride (2 instances each). Retriggering fades the previous instance over 64 frames.
- With `kit.choke` on, closed and pedal hat end open-hat instances.
- Velocity gain: `0.3·((1 − s) + s·(vel/127)²)`, `s = kit.velSens`.
- Voice caps, stealing and polyphony auto-gain apply as for every instrument. Panic and all-notes-off end every instance.
- Voice models and DSP: `a3-audio-implementation.md` (Drum machine).

## Sampler
Chromatic playback of one user-imported source; the zone schema supports multisampling.

```ts
type LoopMode = "off" | "forward" | "pingpong";
type ZoneSelection = "first" | "layer" | "roundRobin";
export interface SamplerZone {
  sourceId: string; sourceName: string;
  keyLow: number; keyHigh: number;      // SFZ lokey, hikey
  velLow: number; velHigh: number;      // SFZ lovel, hivel
  rootNote: number; tune: number;       // SFZ pitch_keycenter, tune (cents)
  start: number; end: number;           // fractions 0–1; SFZ offset, end
  loopMode: LoopMode; loopStart: number; loopEnd: number; loopCrossfadeMs: number;
  group?: number; seqLength?: number; seqPosition?: number;   // SFZ group, seq_length, seq_position
}
export interface SamplerState { selection: ZoneSelection; zones: SamplerZone[]; params: Record<string, number> }
```

- The base build uses one zone covering keys 0–127 and velocities 1–127, with `selection: "first"`. It reads `sourceId`, `sourceName`, `rootNote`, `tune`, the markers, `loopMode` and `loopCrossfadeMs`, and preserves every other field on save.
- Zone selection for multisampling: `first` plays the first matching zone; `layer` plays every matching zone; `roundRobin` plays the matching zone whose `seqPosition` equals a per-group counter cycling 1–`seqLength`, reset on transport start.

| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| `rootNote` | 0–127, step 1 | 60 | MIDI note | lin |
| `fineTune` | −100 to +100 | 0 | cents | lin |
| `start`, `end` | 0–1 | 0, 1 | fraction of source | lin |
| `loopMode` | off, forward, pingpong | off | — | enum |
| `loopStart`, `loopEnd` | 0–1 | 0, 1 | fraction of source | lin |
| `loopCrossfade` | 0–500 | 10 | ms | pow3 |
| `trigger` | gate, trigger | gate | — | enum |
| `attack` | 0–10 000 | 2 | ms | pow3 |
| `decay` | 1–10 000 | 300 | ms | log |
| `sustain` | 0–1 | 1 | — | lin |
| `release` | 5–10 000 | 200 | ms | log |
| `cutoff` | 20–20 000 | 20 000 | Hz | log |
| `resonance` | 0–1 | 0 | — | lin |
| `filterEnvAmount` | −1 to +1 | 0 | × 48 semitones | lin |
| `velSens` | 0–1 | 1 | — | lin |
| `voiceMode` | poly, mono | poly | — | enum |
| `glide` | 0–2000 | 0 | ms | pow3 |
| `pan` | −1 to +1 | 0 | — | lin |
| `level` | −60 to +6 | 0 | dB | lin |

- Sources are user-imported only. Notes beyond ±24 semitones from `rootNote` are silent.
- Interpolation is 4-point cubic Hermite over half-band mip levels 0–2. Forward loops crossfade; loops are at least 64 frames.
- A missing source gives "Audio not loaded: <sourceName>" and silence. Presets store `sourceId` and `sourceName`, never audio.
- Voice caps, stealing and polyphony auto-gain apply. Panic and all-notes-off end every voice in gate and trigger modes.

## Sources
- The MIDI Association, General MIDI Level 1 percussion key map — https://midi.org/
- K. J. Werner, J. S. Abel, J. O. Smith, TR-808 bass drum (DAFx-14), cymbal (ICMC/SMC 2014) and cowbell (AES 2014) models
- SFZ Format opcode reference — https://sfzformat.com/
- O. Niemitalo, "Polynomial Interpolators for High-Quality Resampling of Oversampled Audio," 2001
- Karplus and Strong, "Digital Synthesis of Plucked-String and Drum Timbres," Computer Music Journal 7(2), 1983
- Jaffe and Smith, "Extensions of the Karplus-Strong Plucked-String Algorithm," Computer Music Journal 7(2), 1983
- Chowning, "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation," JAES 21(7), 1973
