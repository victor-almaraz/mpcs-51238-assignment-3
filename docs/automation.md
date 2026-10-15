# Automation

## Model
```ts
export interface AutomationPoint {
  tick: Tick; value: number;                 // normalized [0, 1] in the ParamDef scale
  curve: 'step' | 'linear' | 'curve';        // shape of the segment to the next point
  tension?: number;                          // [−1, 1]; 0 equals linear
}
export interface CompiledCurve { version: number; ticks: Float64Array; values: Float32Array; shapes: Uint8Array; tensions: Float32Array }
```
- Points are sorted by tick; ticks are unique per lane.
- `curve` segments: v(u) = v₀ + (v₁ − v₀)·g(u), u ∈ [0, 1], g(u) = u^(2^(−3·tension)) (project choice).

## Parameter IDs
- `ParamId` = `${ownerId}/${paramKey}`. Owners are devices and tracks; track keys are `gain`, `pan` and `send:<SendId>`.
- Every automatable parameter has a `ParamDef` (`audio-safety.md`). Normalized values map to plain values through its scale.
- WAM parameters use `${DeviceId}/${WamParameterInfo.id}`.

## Evaluation
- Curves are evaluated on the audio thread against the tempo map.
- Gain and pan are evaluated per sample. Other built-in parameters are evaluated per 32-frame sub-block with smoothing (project limit).
- WAM parameters receive at most one automation event per parameter per quantum (`plugins-wam.md`).
- Touching a control during playback suspends that parameter's automation until transport stop.
- A lane with `enabled: false` leaves the parameter at its static value.

## Recording automation
- Stage 4 records in latch mode: values are written from first touch to transport stop.
- Recorded data is thinned to points with error ≤ 0.5% of range (project limit).

## Sources
- WAM API — https://github.com/webaudiomodules/api
