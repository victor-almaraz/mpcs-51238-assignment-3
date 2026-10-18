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
- The transport edits the first tempo point (an integer 40–240 BPM, as in the New project form) and the meter from bar 1 (2/4, 3/4, 4/4 or 6/8). Both are project edits and can be undone (`project-model.md`, Commands and undo).

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
  position(): TransportPosition;          // from the latest engine position report
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
| Play | Starts at the playhead with the 50 ms safety fade-in (`audio-safety.md`). From a stop, the playhead becomes the play start (`playStart`). Resuming from a pause keeps the play start. |
| Pause | Halts playback in place and keeps the playhead there. Play resumes from it. |
| Stop | While playing or paused: halts and returns the playhead to the play start. While stopped: moves the playhead to bar 1, or to the loop start when the loop is on; Stop is disabled when the playhead is already there. Stopping releases sequenced notes and fades audio clips over 64 frames; effect tails continue. |
| Transport state | One of Playing, Paused or Stopped. Play and Pause share one control, named for the action it performs. A project always opens stopped, at its saved playhead. |
| Loop | A pass that reaches `end` from before it continues at `start` in the same render block; the wrap is sample-accurate. Sequenced notes receive note-off at the wrap; live notes continue. Playback that starts at or after `end`, or passes `end` while the loop is off, continues without wrapping. Minimum length: one snap-grid step. |
| Tempo edit during playback | The playing position is kept in ticks: after the recompiled model, the engine is located to the same tick under the new tempo map, so playback continues from the same musical position. |
| Punch | Recording keeps only material inside the punch range. Capture runs outside it for pre-roll monitoring (`recording.md`). |
| Count-in | 0–2 bars at the tempo at the start position; metronome only. |
| Metronome | Engine-generated click on every beat while playing: 1.5 kHz sine on the downbeat, 1 kHz on other beats, exponential decay with a 30 ms time constant, −12 dB relative to master (project limits). The Metronome toggle and the `C` key turn it on and off; the choice is a saved setting. Export excludes the click. |
| Locate | Moves the playhead. During playback, releases sequenced notes and continues from the new position at the next render quantum. `Home` locates to bar 1 and `Shift+Home` to the loop start. |
| Follow playhead | While playing, the arrangement view scrolls when the playhead leaves the visible lanes or wraps back before them, placing the playhead near the left edge. |

## Playhead synchronization
- The engine posts a `pos` message with `playFrame` and `ctxFrame` (`currentFrame` at block start) every `REPORT_QUANTA` quanta, about every 25 ms (`a3-audio-implementation.md`, Engine to main).
- On each `requestAnimationFrame`, the UI advances the last reported `playFrame` by the audible context time since the report. The audible time comes from `getOutputTimestamp()`; where that is unavailable or reports `contextTime` 0, it is `currentTime − baseLatency − outputLatency`. With the loop on, the position wraps by the Loop rule above.
- `baseLatency` and `outputLatency` are read on every position query; `outputLatency` can read 0 until audio flows.
- Playheads are separate elements moved with `style.transform`; playback does not repaint the timeline or piano-roll canvases.

## Unconfirmed
- Accuracy of `outputLatency` and `getOutputTimestamp()` in Safari.

## Sources
- MDN AudioContext.getOutputTimestamp — https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp
- MDN AudioContext.outputLatency — https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/outputLatency
