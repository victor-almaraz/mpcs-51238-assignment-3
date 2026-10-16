# Project model

## Identifiers
- IDs are opaque strings: a type prefix plus a 21-character URL-safe random suffix from `crypto.getRandomValues`.
- IDs are stable across save, load and archive.

```ts
type Brand<T, B> = T & { readonly __brand: B };
export type ProjectId = Brand<string, 'prj'>; export type TrackId = Brand<string, 'trk'>;
export type ClipId = Brand<string, 'clp'>;    export type NoteId = Brand<string, 'nte'>;
export type SourceId = Brand<string, 'src'>;  export type DeviceId = Brand<string, 'dev'>;
export type LaneId = Brand<string, 'aut'>;    export type SendId = Brand<string, 'snd'>;
export type ParamId = Brand<string, 'par'>;   // `${DeviceId | TrackId}/${paramKey}`
export type Tick = number;                    // integer, PPQ 960
export type Frames = number;                  // integer
```

## Document
The document is normalized: entity maps plus order arrays.

```ts
export interface ProjectDoc {
  schemaVersion: number;
  id: ProjectId; name: string; createdAt: string; modifiedAt: string;  // ISO 8601
  tempo: TempoPoint[]; meter: MeterPoint[];                           // transport-and-timing.md
  trackOrder: TrackId[];
  tracks: Record<TrackId, Track>;
  clips: Record<ClipId, Clip>;
  sources: Record<SourceId, SourceRef>;
  devices: Record<DeviceId, Device>;
  lanes: Record<LaneId, AutomationLane>;
  sends: Record<SendId, Send>;
  masterTrackId: TrackId;
  markers: Marker[];
  loop: TickRange | null; punch: TickRange | null;
  extensions: Record<string, unknown>;   // preserved unknown fields
}
export type TrackKind = 'instrument' | 'audio' | 'bus';
export interface Track {
  id: TrackId; kind: TrackKind; name: string; color: string;
  deviceIds: DeviceId[];                 // processing order
  output: TrackId | null;                // bus or master; null only for master
  gainDb: number; pan: number;           // pan ∈ [−1, 1]
  mute: boolean; solo: boolean; soloSafe: boolean; armed: boolean;
  sendIds: SendId[]; laneIds: LaneId[]; clipIds: ClipId[];
  input?: InputSelection;                // recording.md
}
export type Clip = MidiClip | AudioClip;
interface ClipBase { id: ClipId; trackId: TrackId; start: Tick; name: string; muted: boolean; color?: string }
export interface MidiClip extends ClipBase { kind: 'midi'; length: Tick; loopLength?: Tick; notes: Note[] } // notes in [0, loopLength) repeat to fill the clip
export interface Note { id: NoteId; tick: Tick; length: Tick; pitch: number; velocity: number; channel: number } // tick relative to clip start
export interface AudioClip extends ClipBase {
  kind: 'audio'; sourceId: SourceId;
  sourceOffset: Frames; sourceLength: Frames;   // source frames at the original sample rate
  gainDb: number; fadeIn: Fade; fadeOut: Fade;
  takeGroup?: string;
}
export interface Fade { length: Frames; curve: 'linear' | 'equalPower' | 'exp' }  // source frames
export interface SourceRef {
  id: SourceId; name: string; path: string;     // relative path inside the project
  sampleRate: number; channels: number; frames: Frames; format: string; sha256: string;
}
export type Device = BuiltinDevice | PluginDevice;
export interface BuiltinDevice { id: DeviceId; kind: 'builtin'; type: string; bypass: boolean; params: Record<string, number> }
export interface PluginDevice {
  id: DeviceId; kind: 'wam'; pluginId: string; version: string; bypass: boolean;
  state: string;                                // base64 of plugin-provided state
  latencyFrames?: Frames;
}
export interface Send { id: SendId; from: TrackId; to: TrackId; gainDb: number; preFader: boolean; muted: boolean }
export interface AutomationLane { id: LaneId; paramId: ParamId; enabled: boolean; points: AutomationPoint[] } // automation.md
export interface Marker { tick: Tick; name: string }
```

## Invariants
- Every ID reference resolves. The loader repairs or rejects dangling references (`project-file-format.md`).
- `Note.pitch` ∈ [0, 127]; `velocity` ∈ [1, 127]; `channel` ∈ [0, 15]; `length` ≥ 1.
- The routing graph (outputs plus sends) is acyclic and ends at `masterTrackId`.
- Fade-in length + fade-out length ≤ clip source length.
- The document is immutable. Each command produces a new document with structural sharing.

## Commands and undo
```ts
export interface Command { type: string; payload: unknown; coalesceKey?: string }
export type CommandResult = { ok: true; change: ChangeSet } | { ok: false; error: CommandError };
export interface ChangeSet { touched: string[] }            // entity IDs
export interface CommandError { code: 'invalid' | 'cycle' | 'limit' | 'missing'; message: string }
export interface GestureToken { readonly id: number }
export interface Selection {
  tracks: TrackId[]; clips: ClipId[]; notes: NoteId[];
  lanePoints: { lane: LaneId; index: number }[]; timeRange: TickRange | null;
}
```
- Each command records an inverse patch.
- Commands with equal `coalesceKey` within 500 ms merge into one undo step (project limit).
- A gesture (for example a fader drag) groups its commands into one undo step.
- History depth: 500 steps (project limit). Selection is not part of history.

## Snapping
- Grid values: 1/1 to 1/64, triplet and dotted variants; bar and beat grids follow the meter map.
- Snapping preserves an item's offset to the grid. `Shift` during a drag disables snapping.

## Autosave and recovery
- Every applied command appends a checksummed journal record in OPFS, written by the disk worker.
- A snapshot is written every 60 s or every 200 commands, whichever comes first (project limits).
- On open, the newest valid snapshot loads and later journal records replay. A record with a bad checksum ends replay, and the user is told how many records were discarded.

## Schema versioning
- `schemaVersion` is an integer. Migrations are pure functions `vN → vN+1`, applied in sequence on load.
- A document newer than the app supports opens read-only with a warning.
