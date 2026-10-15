# Transport and timing

## Tempo map
- An ordered list of `TempoPoint { tick, bpm, shape: 'step' | 'linear' }`. `bpm` ∈ [20, 999] (project limit). The first point is at tick 0.
- A `linear` point ramps tempo linearly in ticks to the next point.

Seconds at tick x within a segment starting at tick x₀, second s₀, tempo b₀, ending at tempo b₁ after L ticks:

| Shape | Formula |
|---|---|
| Constant (`step`, or b₁ = b₀) | s = s₀ + 60·(x − x₀)/(960·b₀) |
| Linear (b₁ ≠ b₀) | s = s₀ + 60·L/(960·(b₁ − b₀)) · ln(b(x)/b₀), with b(x) = b₀ + (b₁ − b₀)·(x − x₀)/L |

- Seconds to ticks uses the closed-form inverse within each segment.
- Event frame = floor(s·fs), computed in float64 (a3-audio-implementation.md, Tempo map).
- `CompiledTempoMap` stores per-segment s₀ and coefficients; lookup is O(log n).
- Time signature: `MeterPoint { tick, numerator, denominator }`, placed at bar boundaries only.

```ts
export interface TempoPoint { tick: Tick; bpm: number; shape: 'step' | 'linear' }
export interface MeterPoint { tick: Tick; numerator: number; denominator: 1 | 2 | 4 | 8 | 16 | 32 }
export interface CompiledTempoMap { ticks: Float64Array; seconds: Float64Array; bpm0: Float64Array; bpm1: Float64Array; lengths: Float64Array }
```

## Event delivery
- For each quantum [f, f + N), the sequencer emits events whose frame lies in the interval, with offset = frame − f. N is the actual block length.
- Instrument kernels apply events at their exact offset.
- Events to WAM plugins are emitted one quantum ahead, timestamped in context seconds (`plugins-wam.md`).
- At equal frames, note-offs precede note-ons.

## Transport
```ts
export interface TransportControl {
  play(): void; stop(): void; pause(): void;
  locate(tick: Tick): void;
  setLoop(range: TickRange | null): void;
  setPunch(range: TickRange | null): void;
  setMetronome(m: MetronomeSettings): void;
  setCountIn(bars: 0 | 1 | 2): void;
  position(): TransportPosition;          // reads the SAB playhead block
}
export interface TickRange { start: Tick; end: Tick }   // end > start
export interface TransportPosition { tick: Tick; frame: number; playing: boolean; contextTime: number }
export interface MetronomeSettings { enabled: boolean; gainDb: number; accentFirstBeat: boolean; duringCountIn: boolean }
export type TransportCmd =
  | { kind: 'play' | 'stop' | 'pause' } | { kind: 'locate'; tick: Tick }
  | { kind: 'loop' | 'punch'; range: TickRange | null }
  | { kind: 'metronome'; settings: MetronomeSettings } | { kind: 'countIn'; bars: 0 | 1 | 2 };
```

| Behaviour | Requirement |
|---|---|
| Loop | At `end`, the next frame plays `start`; the wrap is sample-accurate within the quantum. Notes crossing `end` receive note-off at `end`. Minimum length 1 beat (project limit). |
| Punch | Recording keeps only material inside the punch range. Capture runs outside it for pre-roll monitoring (`recording.md`). |
| Count-in | 0–2 bars at the tempo at the start position; metronome only. |
| Metronome | Engine-generated click: 1.5 kHz accent, 1 kHz beat, 20 ms decay, default −12 dB (project limits). |
| Stop | Releases notes; effect tails continue. |
| Locate during playback | Releases notes, flushes streaming rings, resumes after prefetch (`audio-streaming.md`). |

## Playhead synchronization
- The engine writes `{frame, tick, contextTime}` to the playhead SAB block every quantum.
- The UI reads it on `requestAnimationFrame` and aligns visuals with `getOutputTimestamp()`. Where that is unavailable, it subtracts `baseLatency + outputLatency`.
- `outputLatency` can read 0 until audio flows; it is re-read each second.

## Unconfirmed
- Accuracy of `outputLatency` and `getOutputTimestamp()` in Safari.

## Sources
- MDN AudioContext.getOutputTimestamp — https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp
- MDN AudioContext.outputLatency — https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency
