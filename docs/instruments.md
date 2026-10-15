# Instruments

## Common rules
- Pitch: f = 440·2^((p − 69)/12).
- Velocity gain: 0.3·(vel/127)².
- All randomness uses a seeded mulberry32 PRNG. The seed derives from (device ID, note ID), so renders are reproducible.
- Voice limits and polyphony auto-gain: `audio-safety.md`.

## Kernel interface
```ts
export interface InstrumentKernel {
  readonly type: string;
  readonly params: readonly ParamDef[];
  readonly latencyFrames: number;
  prepare(sampleRate: number, maxFrames: number, seed: number): void;   // may allocate
  noteOn(offset: number, noteId: number, pitch: number, velocity: number): void;
  noteOff(offset: number, noteId: number): void;
  setParam(offset: number, key: string, plainValue: number): void;
  allNotesOff(hard: boolean): void;                  // hard: no release
  render(outL: Float32Array, outR: Float32Array, frames: number): void; // overwrites outputs
  activeVoices(): number;
  getState(): Uint8Array; setState(s: Uint8Array): void;
}
```
- `offset` ∈ [0, frames). Events arrive sorted by offset before `render`.
- Only `prepare` and `setState` allocate.
- The engine checks each kernel's output for non-finite samples (`audio-safety.md`).

## Subtractive
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| waveform | sine, square, saw, triangle | saw | — | enum |
| cutoff | 40–16 000 (≤ 0.45·fs) | 2000 | Hz | log |
| resonance | 0–20 | 1 | dB | lin |
| attack | 0.002–2 | 0.01 | s | pow3 |
| release | 0.01–4 | 0.3 | s | pow3 |

Square, saw and triangle are band-limited.

## FM (two-operator)
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| ratio | 0.5–12, step 0.5 | 2 | × carrier | lin |
| index | 0–20 | 3 | — | lin |
| indexDecay | 0.01–4 | 0.5 | s | pow3 |
| attack | 0.002–2 | 0.005 | s | pow3 |
| release | 0.01–4 | 0.4 | s | pow3 |

- Peak frequency deviation = I·f_m, where f_m = ratio·f_c.
- Nyquist clamp: I_max = max(0, (0.45·fs − f_c)/f_m − 1).

## Additive
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| h1–h8 | 0–1 each | 1, .5, .33, .25, .2, .17, .14, .12 | — | lin |
| attack | 0.002–2 | 0.02 | s | pow3 |
| release | 0.01–4 | 0.5 | s | pow3 |

- Output is divided by max(1, Σh). Harmonics above 0.45·fs are omitted.

## Pluck (Karplus-Strong)
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| damping | 0–1 | 0.5 | — | lin |
| brightness | 0–1 | 0.7 | — | lin |
| decay (T60) | 0.2–10 | 2 | s | pow3 |

- Loop gain ρ = 10^(−3/(T60·f)), capped at 0.9999; total loop gain < 1 at all frequencies.
- Fractional delay: first-order allpass, C = (1 − d)/(1 + d), d ∈ [0.1, 1.1).
- Output passes a DC blocker. Excitation is seeded noise.

## Granular
| Param | Range | Default | Unit | Scale |
|---|---|---|---|---|
| source | saw, noise, chord (generated buffer) | saw | — | enum |
| grainSize | 0.01–0.25 | 0.06 | s | log |
| density | 2–60 | 20 | grains/s | log |
| spray | 0–1 | 0.2 | — | lin |

- ≤ 4 voices and ≤ 64 concurrent grains (project limits). Source buffers are generated in `prepare`.

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
| `kit.level` | −60 to +6 | 0 | dB | dB |
| `kit.velSens` | 0–1 | 1 | — | lin |
| `kit.choke` | off, on | on | — | enum |
| `<voice>.level` | −60 to +6 | 0 | dB | dB |
| `<voice>.tune` | −12 to +12 | 0 | semitones | lin |
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
| `rootNote` | 0–127 | 60 | MIDI note | integer |
| `fineTune` | −100 to +100 | 0 | cents | lin |
| `start`, `end` | 0–1 | 0, 1 | fraction of source | lin |
| `loopMode` | off, forward, pingpong | off | — | enum |
| `loopStart`, `loopEnd` | 0–1 | 0, 1 | fraction of source | lin |
| `loopCrossfade` | 0–500 | 10 | ms | log |
| `trigger` | gate, trigger | gate | — | enum |
| `attack` | 0–10 000 | 2 | ms | log |
| `decay` | 1–10 000 | 300 | ms | log |
| `sustain` | 0–1 | 1 | — | lin |
| `release` | 5–10 000 | 200 | ms | log |
| `cutoff` | 20–20 000 | 20 000 | Hz | log |
| `resonance` | 0–1 | 0 | — | lin |
| `filterEnvAmount` | −1 to +1 | 0 | × 48 semitones | lin |
| `velSens` | 0–1 | 1 | — | lin |
| `voiceMode` | poly, mono | poly | — | enum |
| `glide` | 0–2000 | 0 | ms | log |
| `pan` | −1 to +1 | 0 | — | lin |
| `level` | −60 to +6 | 0 | dB | dB |

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
