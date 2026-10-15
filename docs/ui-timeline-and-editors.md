# UI: timeline and editors

## Rendering
| Surface | Technology |
|---|---|
| Timeline, piano roll, automation lanes, waveforms | Canvas 2D on the main thread; `OffscreenCanvas` in `render.worker.ts` when a frame exceeds budget |
| Meters | Canvas 2D, one canvas per mixer view |
| Menus, dialogs, inspector, mixer controls | React DOM |

WebGL and WebGPU are not used.

## Budgets
| Budget | Value (project limits) |
|---|---|
| Frame | ≤ 16.7 ms at 60 Hz; canvas drawing ≤ 8 ms |
| Main-thread long tasks during playback | None over 50 ms |
| Drawn clips | Viewport plus one screen of margin |
| Waveform level | Coarsest level with ≥ 1 peak pair per pixel |
| Meter refresh | Every animation frame, from SAB |

## React boundaries
- Canvas views are imperative components mounted once. They subscribe to `ProjectService` and redraw on change or animation frame.
- Playhead, meters and drag previews never pass through React state.
- `src/state/` holds UI state only: zoom, scroll, tool, focus. The document lives in `ProjectService`.
- Drag edits run as gestures (`project-model.md`).

## Editors
| Editor | Requirements |
|---|---|
| Arrangement | Tracks as rows; clips move, trim and split; fades by handles; snapping per `project-model.md` |
| Piano roll | Pitch rows 0–127; velocity lane; quantize; keyboard note entry (`accessibility.md`) |
| Audio clip | Trim, gain, fades; crossfade on overlap, equal-power by default |
| Automation | Insert, move and delete points; curve type per segment |
| Mixer | Strips with fader, pan, mute, solo, sends, meter and device list |

## Sources
- MDN OffscreenCanvas — https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
