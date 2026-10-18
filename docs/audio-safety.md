# Audio safety

## Position
- `SafetyProcessor` is the last processor before `destination` in real time and in `OfflineAudioContext` export renders.
- Plugins cannot follow or bypass it.
- Master volume and master pan apply in `EngineProcessor`, after the master chain and the metronome click.
- Stage order inside `SafetyProcessor`: non-finite guard, DC blocker, sustained-level duck, limiter, output fade, final clamp to the ceiling (`a3-audio-implementation.md`, Stage order).

## Audio path
- Every sound renders in the engine and reaches `destination` only through `SafetyProcessor`: instruments, audio clips, the metronome, note previews, auditions and editor previews.
- No sound uses a separate `AudioContext`, an `<audio>` element or a native source node outside the engine graph.
- Every voice, one-shot hit and grain counts toward voice caps and polyphony auto-gain.
- Panic and all-notes-off end every sound, including one-shot drum hits and sampler voices in trigger mode.

## Limits
| Parameter | Value |
|---|---|
| Limiter ceiling | −1 dBFS sample peak (0.8913) (project limit) |
| Limiter look-ahead | 1.5 ms (project limit) |
| Attack | Moving-minimum gain over the look-ahead window, smoothed by a boxcar of the same length |
| Release | One-pole, time constant 50 ms (project limit) |
| Non-finite trigger | NaN, ±Infinity, or \|x\| > 1e4 |
| Non-finite response | Mute 250 ms, reset state, fade in over 50 ms, reset affected kernels (project limits) |
| DC blocker | One-pole high-pass, ≈10 Hz corner (project limit) |
| Sustained-level guard | −6 dB duck when 3 s RMS > −12 dBFS; holds until user acknowledgement (project limits) |
| Master gain | Default −12 dB; maximum 0 dB (project limits) |
| Start, resume and suspend fades | 50 ms (project limit) |
| Parameter smoothing | One-pole, τ 10–15 ms, for gain and filter parameters (project limit) |
| Voices | 16 per instrument, 64 global; the quietest released voice is stolen first, then the oldest held voice; a stolen voice fades over 64 frames (project limits) |
| Polyphony auto-gain | min(1, 2/√voices) (project limit) |
| MIDI flood limit | 200 note-ons/s per input source; excess dropped and reported (project limit) |
| Monitoring gain | Default −12 dB; maximum 0 dB (project limits) |

## Behaviour
- No sound on page load. The `AudioContext` is created on the first user gesture that requests audio.
- On the first sound-producing action of each page session, a notice asks the user to lower device volume, unless the user dismissed it on this device (`assignment-3-scope.md`, Volume notice).
- Project load ramps master from silence over 50 ms after the first rendered quantum.
- Every parameter value passes through one `ParamDef` table and is clamped to its range before use.
- Each effect slot checks the energy of its output every block. A non-finite or excessive block (energy above 1e12) resets the slot's kernel and bypasses the slot on its own, and the mix continues. A block that is already non-finite when it enters a slot is silenced there. Any non-finite sample that reaches `SafetyProcessor` trips the non-finite guard.
- The master meter shows the post-limiter signal. A limit indicator shows while gain reduction exceeds 0.5 dB. Indicators hold for 1 s and never flash.
- Panic is a button, and `Escape` when no menu or dialog is open and focus is outside text fields. It stops the transport, fades every voice, drum instance, preview and audition over 64 frames, silences the metronome click, clears effect state, and restarts the safety stage's 50 ms fade-in from silence (project limits).
- Monitoring feedback protection is specified in `recording.md`.

## Types
```ts
export type SafetyEvent =
  | { kind: 'nonFinite'; scope: 'track' | 'device' | 'master'; id?: string }
  | { kind: 'limiting'; reductionDb: number }
  | { kind: 'sustainedLevel'; rmsDb: number; requiresAck: true }
  | { kind: 'midiFlood'; sourceId: string; dropped: number }
  | { kind: 'panic' };
export interface ParamDef {
  id: string; min: number; max: number; default: number; unit: string;
  scale: 'lin' | 'log' | 'pow3' | 'enum'; options?: readonly string[]; smoothingMs?: number;
}
```

## Acceptance
Worst-case renders through the full graph:
- 64 simultaneous full-velocity notes;
- resonant filter sweep at maximum resonance;
- NaN and Infinity injected into one track;
- full-scale 1 kHz square on all tracks;
- a routing command that would create a cycle (rejected; render unaffected).

| Criterion | Threshold |
|---|---|
| Peak \|x\| | ≤ 0.8913 |
| Non-finite samples | 0 |
| \|DC\| per 1 s window | ≤ 1e-3 |
| Onset peak (first 10 ms after start) | ≤ 0.02 |
| Fade-in completion | ≤ 60 ms |

## Standards context
- ITU-T H.870 and IEC 62368-1 (RS1/RS2) address listening-level exposure for devices.
- EBU R 128 sets a −1 dBTP maximum true-peak level for programme delivery.
- The −1 dBFS sample-peak ceiling is a design choice. It does not bound inter-sample peaks.

## Sources
- Web Audio API 1.1 — https://www.w3.org/TR/webaudio-1.1/
- ITU-T H.870 — https://www.itu.int/rec/T-REC-H.870
- EBU R 128 — https://tech.ebu.ch/publications/r128
- ITU-R BS.1770-5 — https://www.itu.int/rec/R-REC-BS.1770
