# Audio engine

This document describes the full engine design, with WAM plugin segments, `SharedArrayBuffer` state blocks and delay compensation. The Assignment 3 build implements a subset, specified in `a3-audio-implementation.md`:
- The graph is always `EngineProcessor` (`wrack-engine`) → `SafetyProcessor` (`wrack-safety`) → `destination`. There are no plugins, segments, buses, sends or delay compensation.
- The main thread and the worklet exchange `MessagePort` messages only (`a3-audio-implementation.md`, Messaging protocol); no `SharedArrayBuffer` is used, so cross-origin isolation is not required. Playhead position and meters arrive in `pos` messages.
- The engine reads the frame count of each `process()` call and renders in blocks of at most 128 frames. A project holds at most 16 tracks.
- Kernels do not use `try`/`catch` in `process()`. An effect slot whose output is non-finite resets and bypasses itself and reports a `fault`; the safety stage guards the output. The client does not rebuild the context after `processorerror`.

## Node graph
```
[MediaStreamAudioSourceNode]* ─► [CaptureProcessor]*          (input → disk worker via SAB)
[EngineProcessor] ─► [WamNode] ─► [SegmentProcessor] ─► ... ─► [SafetyProcessor] ─► destination
                                                                     └─► [CaptureProcessor] (master capture)
```
- Without plugins the graph is `EngineProcessor → SafetyProcessor → destination`.
- The graph is acyclic. Web Audio cycles require a `DelayNode` and add at least one render quantum of latency; cycles are not used.

## Segments and processor assignment
- A WAM plugin on a channel strip ends the current segment. The processor hosting the strip exposes the pre-plugin signal on a dedicated output; the plugin's output feeds a downstream `SegmentProcessor`, which runs the remainder of that strip.
- Strips are assigned to processors in topological order of the routing graph (outputs and sends). A strip runs in the first processor that is downstream of every processor feeding it. A bus that receives signal from a post-plugin segment therefore runs in a `SegmentProcessor`, never in `EngineProcessor`.
- The master strip runs in the most downstream processor before `SafetyProcessor`.
- Every routing or device change publishes a complete `GraphPlan`, applied with a 10 ms crossfade (project limit).

## Real-time budget
| Item | Value |
|---|---|
| Render quantum | 128 frames: 2.67 ms at 48 kHz, 2.90 ms at 44.1 kHz |
| Engine `process()` mean | ≤ 40% of quantum duration (project limit) |
| Engine `process()` p99 | ≤ 70% of quantum duration (project limit) |
| Allocations in `process()` | Zero |
| Messages handled per quantum | ≤ 64 (project limit); excess deferred |
| Tracks | 64 (project limit) |
| Buses | 16 (project limit) |

- `AudioWorkletGlobalScope` exposes no `performance` object. Budgets are verified by timed renders in the export worker and in `OfflineAudioContext` (`testing-and-acceptance.md`).
- In real time, the main thread polls `AudioContext.playbackStats` once per second where it exists and reports underruns.

## Engine state
```ts
export type EngineState =
  | { kind: 'idle' } | { kind: 'starting' }
  | { kind: 'running'; sampleRate: number; baseLatency: number; outputLatency: number }
  | { kind: 'suspended' } | { kind: 'interrupted' }
  | { kind: 'failed'; reason: EngineFailure };
export type EngineFailure = 'no-isolation' | 'worklet-load' | 'processor-error' | 'context-closed';
```

## Messages: main to audio
```ts
export type EngineMsg =
  | { t: 'graph'; plan: GraphPlan }
  | { t: 'events'; trackId: TrackId; version: number; list: CompiledEventList }
  | { t: 'tempo'; version: number; map: CompiledTempoMap }        // transport-and-timing.md
  | { t: 'transport'; cmd: TransportCmd }
  | { t: 'param'; paramId: ParamId; value: number }               // plain value, clamped by ParamDef
  | { t: 'automation'; paramId: ParamId; curve: CompiledCurve }   // automation.md
  | { t: 'panic' };
/** Struct-of-arrays sorted by tick. Buffers are transferred. */
export interface CompiledEventList {
  ticks: Float64Array; kinds: Uint8Array; data1: Uint8Array; data2: Uint8Array; noteIds: Uint32Array;
}
export interface GraphPlan {
  version: number;
  processors: ProcessorPlan[];   // topological order
}
export interface ProcessorPlan {
  processorIndex: number;        // 0 = EngineProcessor
  strips: StripPlan[];           // processing order within the processor
}
export interface StripPlan {
  trackId: TrackId;
  devices: DeviceId[];           // built-in devices of this segment
  endsAtPlugin: DeviceId | null; // WAM device that ends this segment
  outputs: { to: TrackId; gainParam: ParamId; preFader: boolean }[];
  latencyCompensationFrames: number;
}
```

## Messages: audio to main
```ts
export type EngineEvt =
  | { t: 'ready' }
  | { t: 'applied'; kind: 'graph' | 'events' | 'tempo'; version: number }
  | { t: 'safety'; e: SafetyEvent }                 // audio-safety.md
  | { t: 'deviceFault'; deviceId: DeviceId; reason: string };
```
High-rate state uses SAB blocks: playhead, meters (`audioworklet-and-wasm.md`).

## Invariants
- A message takes effect at a render-quantum boundary. Note events within a quantum are sample-accurate (`transport-and-timing.md`).
- `process()` returns `true`.
- An exception inside a device kernel is caught per device. The device is muted and a `deviceFault` is posted. The engine continues.
- An uncaught exception in `process()` fires `processorerror` and silences the node permanently. The main thread then rebuilds the context, restores the transport position and reapplies the safety start ramp.

## Delay compensation
- Each device reports `latencyFrames`: built-in devices declare it; WAM devices use a measured or entered value (`plugins-wam.md`).
- Per path to a sum point, `pathLatency = Σ latencyFrames`. Each input to a sum point is delayed by `maxPathLatency − pathLatency`.
- Compensation per sum point is capped at 8192 frames (project limit).
- Recording compensation adds the playback path latency (`recording.md`).

## Unconfirmed
- Per-node `process()` overhead of `AudioWorkletNode` in each engine, measured.

## Sources
- Web Audio API 1.1 — https://www.w3.org/TR/webaudio-1.1/
- MDN AudioContext.playbackStats — https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/playbackStats
- Chrome: audio worklet design pattern — https://developer.chrome.com/blog/audio-worklet-design-pattern
