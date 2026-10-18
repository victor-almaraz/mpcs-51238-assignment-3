# Project model

## Identifiers
- IDs are opaque strings: a type prefix, an underscore and a 21-character URL-safe random suffix from `crypto.getRandomValues`, for example `trk_V1StGXR8_Z5jdHi6B-myT`.
- Source IDs are the exception: a `SourceId` is the lowercase hex SHA-256 of the source file's original bytes, so one file has one ID in every project.
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
  loop: TickRange | null; punch: TickRange | null;   // loop: default loop range of the working state
  audioRate?: number;                    // fs at which audio-clip frame offsets were recorded; set on the first import
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
  sourceOffset: Frames; sourceLength: Frames;   // source frames at the original sample rate; a loop repeats this window
  length?: Tick; loopLength?: Tick;             // looping clips only: played length and pass period (Clip loops)
  gainDb: number; fadeIn: Fade; fadeOut: Fade;
  envelope: GainPoint[];                        // clip gain envelope (a3-audio-implementation.md, Gain stages)
  takeGroup?: string;
}
export interface GainPoint { id: string; frame: Frames; gain: number }  // clip-relative frame; linear gain 0–1.9953
export interface Fade { length: Frames; curve: 'linear' | 'equalPower' | 'exp' }  // source frames
export interface SourceRef {
  id: SourceId; name: string; path: string;     // relative path inside the project
  sampleRate: number; channels: number; frames: Frames; format: string; sha256: string;
}
export type Device = BuiltinDevice | PluginDevice;
export interface BuiltinDevice {
  id: DeviceId; kind: 'builtin'; type: string; bypass: boolean; params: Record<string, number>;
  sampler?: DeviceSource | null;                // sampler zone source
  granular?: DeviceSource | null;               // granular File source
}
export interface DeviceSource { sourceId: SourceId; sourceName: string }
export interface PluginDevice {
  id: DeviceId; kind: 'wam'; pluginId: string; version: string; bypass: boolean;
  state: string;                                // base64 of plugin-provided state
  latencyFrames?: Frames;
}
export interface Send { id: SendId; from: TrackId; to: TrackId; gainDb: number; preFader: boolean; muted: boolean }
export interface AutomationLane { id: LaneId; paramId: ParamId; enabled: boolean; points: AutomationPoint[] } // automation.md
export interface Marker { tick: Tick; name: string }
```

## Clip loops
A clip loops while `loopLength` is set. It repeats every `loopLength` ticks from `start` until `start + length`.

- A MIDI clip repeats the notes in `[0, loopLength)` (`expandClipNotes`).
- An audio clip repeats its window, the source frames `[sourceOffset, sourceOffset + sourceLength)`. Its `length` and `loopLength` are ticks; `sourceLength` stays the window length.
- Turning looping on sets `loopLength` and `length` to the clip's length in ticks. For an audio clip that is its end tick minus its start, so the first pass is the whole window and turning looping on does not change what the clip plays.

### Audio loop passes
`audioPasses(doc, clip)` in `clip-commands.js` lists the passes of an audio loop as plain audio clips. The compile step, the timeline drawing and the edits all use it.

- Pass `k` starts at tick `start + k·loopLength` and reads the window from its first frame.
- A pass is cropped at the next pass start and at the clip end. A window shorter than its period is followed by silence until the next pass. Pass starts fall on ticks, so a window that is not a whole number of ticks long ends less than one tick before the next pass; on a tempo ramp, the period in frames differs from pass to pass.
- Each pass is the window clip with its end trimmed to the pass. Clip gain, fades and the envelope apply to every pass: each pass fades in and fades out, and a cropped pass fades out at its crop. The envelope repeats in every pass and keeps the points that shape the cropped part.
- Automatic crossfades treat each pass as a clip. A later clip that starts inside the last pass and outlasts it crossfades with that pass; passes lying wholly inside another clip get no automatic fades.
- The compile step emits one engine clip per pass, so a loop renders the same as its passes written out as clips, in playback and in WAV export. A loop plays at most 1000 passes (`MAX_LOOP_PASSES`, the engine's clips per track); a track keeps at most 1000 engine clips and 20 000 envelope points, the earliest first.

### Loop edits
- With looping on, an end trim changes `length` in ticks, from 64 frames up to 1000 passes. The window changes only while looping is off.
- Turning looping off keeps what the clip plays: a MIDI loop's repeats become notes; an audio loop becomes one clip per pass (`unrollAudioLoop`), the first keeping the clip's ID.
- Split, a start trim and Join write a loop out first. An audio split then splits the pass at the split point; at a pass boundary, the passes on either side are the two parts. A start trim trims the first pass. Join joins the last pass of the first clip with the first pass of the second.

## Track colours
New tracks take the next colour of this list in order (track count modulo 11). A clip has the colour of its track unless `color` is set; the clip properties offer the same list. The values are in `src/lib/project/clip-commands.js` (`COLORS`); each reaches at least 3.5:1 contrast on the track lanes, and none uses a hue reserved for a semantic colour (focus blue, danger red, primary orange, lamp amber).

| Colour | Value |
|---|---|
| Teal | `#20857b` |
| Violet | `#6a4fa9` |
| Olive | `#667f30` |
| Rose | `#b54076` |
| Copper | `#a25e2b` |
| Slate | `#576574` |
| Plum | `#8c3f91` |
| Steel | `#237486` |
| Mustard | `#827525` |
| Pine | `#2b7351` |
| Taupe | `#766558` |

The master bus has the colour `#1c1a16` and no lane.

## Invariants
- Every ID reference resolves. The loader repairs or rejects dangling references (`project-file-format.md`).
- `Note.pitch` ∈ [0, 127]; `velocity` ∈ [1, 127]; `channel` ∈ [0, 15]; `length` ≥ 1.
- The routing graph (outputs plus sends) is acyclic and ends at `masterTrackId`.
- Fade-in length + fade-out length ≤ clip source length.
- The document is immutable. Each command produces a new document with structural sharing.

## Commands and undo
### Commands
- Commands are pure functions in `src/lib/project/` (`model.js`, `clip-commands.js`, `midi-commands.js`, `effect-commands.js`). Each takes a document and arguments and returns a new document; the input document is never changed.
- A command that can fail returns `{ ok: true, doc, …ids }` or `{ ok: false, error: { code, message } }`, with `code` one of `invalid`, `missing` or `limit`. `message` is the user-facing text.
- The editor applies each result through one edit path, which saves the document (Saving) and sends it to the engine.

```ts
export type CommandResult<Ids = {}> = ({ ok: true; doc: ProjectDoc } & Ids) | { ok: false; error: CommandError };
export interface CommandError { code: 'invalid' | 'missing' | 'limit'; message: string }
```

| Command | Effect |
|---|---|
| `addInstrumentTrack(doc, type, name?)` | Appends an instrument track playing `type` at default settings, with the next track colour. At most 16 tracks (project limit). |
| `addAudioTrack(doc, name?)` | Appends an empty audio track. |
| `setInstrumentType(doc, trackId, type)` | Replaces the track's instrument with a new device of `type` at default settings. Clips and notes, effects, mixer settings, name and colour stay; the old instrument's settings are dropped, and sources only it used leave `sources`. The new device has a new ID. |
| `renameTrack(doc, trackId, name)` | Sets the name, 1–60 characters after trimming. The master bus cannot be renamed. |
| `removeTrack(doc, trackId)` | Removes the track with its clips, devices, sends and lanes; sources nothing else uses leave `sources`. The master bus cannot be removed. The editor's Delete track asks for confirmation when the track has clips. |
| `setTrack(doc, trackId, changes)` | Sets mixer fields: `gainDb`, `pan`, `mute`, `solo`. |
| `renameClip(doc, clipId, name)` | Sets the clip name, 1–60 characters after trimming. |
| `setClipColor(doc, clipId, color)` | Sets the clip colour, a `#rrggbb` value. |
| Clip editing | `addAudioClip`, `createClip`, `moveClip`, `duplicateClip`, `deleteClip`, `splitClip`, `joinClips`, `trimStart`, `trimEnd`, `setClipGain`, `setFade` and the envelope-point commands (`a3-audio-implementation.md`, Edit math). |
| Clip loops | `setClipLooping(doc, clipId, on)` and `loopEnd(doc, clipId, deltaTicks)`, which turns looping on and trims the end (Clip loops). |
| Note editing | `addNote`, `moveNote`, `resizeNote`, `setVelocity`, `deleteNote`, `quantize`, `setLoopLength` (`midi-commands.js`). |
| Effects | `addEffect`, `removeEffect`, `moveEffect`, `setEffectBypass` (`effect-commands.js`). |
| Transport and devices | `setTempo`, `setTimeSignature`, `setDeviceParam`, `setGranularSource`, `setSamplerSource`. |

### Undo and redo
- The editor (`src/components/studio/Studio.jsx`) keeps a history of whole documents. Documents are immutable, so each history entry shares structure with its neighbours.
- An edit that changes the document records the previous document as one undo step. An edit less than 600 ms after the previous edit joins that edit's step, so a knob or fader drag, or a burst of nudges, undoes as one step (project limit).
- The history keeps at most 200 undo steps; the oldest step is dropped first (project limit). A new edit clears the redo steps.
- Undo and redo apply the stored document through the same edit path, so the result is saved and reaches the engine. The edit after an undo or redo always starts a new step.
- Undo is `Ctrl`/`Cmd+Z`; redo is `Ctrl`/`Cmd+Shift+Z` or `Ctrl`/`Cmd+Y`. Both are also in the Edit menu and the command palette. In text fields, the keys perform the field's own undo and redo.
- Every project edit is undoable, including track deletion, instrument changes, renames, tempo and meter. Working state (selection, playhead, loop, zoom, scroll, snap, dock, armed tracks) is not part of history (`storage.md`, Assignment 3 build).
- History lives in memory for the open editor. It starts empty each time a project opens and is not saved.
- Stored audio that an edit drops stays in IndexedDB while any document in the undo or redo history references it, so undo can bring the audio back. Once the edit is saved, stored sources that no saved project and no history entry references are removed.
- A read-only project accepts no edits; Undo and Redo are disabled.

## Snapping
- The arrangement grid is Bar, 1/4, 1/8 or 1/16 (working-state `snap` values `bar`, `1`, `0.5`, `0.25`, in quarter notes). Bar and beat grids follow the meter.
- `N` turns snapping on and off; `+` and `−` select a finer or coarser grid. `Alt` during a drag bypasses snapping.
- A clip drag snaps the distance moved to the grid step, so a clip keeps its offset to the grid. Loop-range edges and the edit cursor snap to grid lines.
- Keyboard nudges always move by one grid step, whether snapping is on or off.
- The piano roll has its own grid (`ui-timeline-and-editors.md`).

## Saving
- Each edit saves the whole document as JSON to `localStorage` (`wrack:v1:project:<id>`) 500 ms after the last edit, and at once on `pagehide` (project limit; `assignment-3-scope.md`, Persistence). `modifiedAt` is set on every edit.
- A failed save leaves the stored document unchanged. The editor header shows "Not saved" and a banner states the error.
- An example copy is saved as a project on its first edit.

## Schema versioning
- `schemaVersion` is an integer. Migrations are pure functions `vN → vN+1`, applied in sequence on load.
- A document newer than the app supports opens read-only with a warning.
