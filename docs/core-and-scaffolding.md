# Core and scaffolding

## Definitions
- **Core:** modules the developer writes by hand. Agents do not implement core logic.
- **Scaffolding:** modules coding agents generate.
- **Seam:** a TypeScript interface in `src/seams/` through which scaffolding calls core.

## Path ownership
| Path | Owner | Agent permissions |
|---|---|---|
| `src/core/**` | Core | Create typed stubs only (Stub rules) |
| `src/seams/**` | Core | Read only |
| `src/worklets/**` | Core | Read only |
| `src/workers/disk.worker.ts`, `src/workers/export.worker.ts` | Core | Read only |
| `wasm/**` | Core | Read only |
| `tests/core/**`, `tests/engine/**` | Core | Read only |
| `docs/**` | Developer | Read only |
| `src/app/**`, `src/ui/**`, `src/state/**`, `src/platform/**` | Scaffolding | Generate |
| `src/workers/render.worker.ts` | Scaffolding | Generate |
| `src/sw/**` | Scaffolding | Generate within `privacy-and-security.md` and `plugins-wam.md` constraints |
| `tests/harness/**`, `tests/e2e/**` | Scaffolding | Generate |
| `scripts/**`, `.github/**`, configuration files | Scaffolding | Generate |

## Core module map
| Core path | Doc |
|---|---|
| `src/core/engine/` | `audio-engine.md` |
| `src/core/dsp/`, `src/core/instruments/` | `instruments.md`, `mixer-and-routing.md` |
| `src/core/transport/` | `transport-and-timing.md` |
| `src/core/midi/` | `midi.md` |
| `src/core/osc/` | `osc-web-serial.md` |
| `src/core/model/` | `project-model.md` |
| `src/core/format/` | `project-file-format.md` |
| `src/core/storage/` | `storage.md` |
| `src/core/streaming/` | `audio-streaming.md` |
| `src/core/recording/` | `recording.md` |
| `src/core/mixer/` | `mixer-and-routing.md` |
| `src/core/automation/` | `automation.md` |
| `src/core/safety/` | `audio-safety.md` |
| `src/core/plugins/` | `plugins-wam.md` |
| `src/core/export/` | `export.md` |
| `src/core/shared/` | `audioworklet-and-wasm.md` |

## Stub rules
1. A stub implements a seam interface with exact signatures.
2. Every stub method throws `NotImplementedError` from `src/seams/errors.ts`.
3. A stub lives at the path in the seam's `@impl` tag. Its first line is `// STUB: core-owned; replace by hand`.
4. Scaffolding obtains core services only through `createCoreServices()` in `src/seams/registry.ts`.
5. Scaffolding catches `NotImplementedError` and shows an unavailable state.
6. Agents do not modify seam files, worklet files or WASM sources.

## Seam interfaces
Domain types (`ProjectDoc`, `Track`, `Command`, IDs) are defined in `project-model.md`. Other referenced types are defined in the doc named in each comment.

```ts
// src/seams/errors.ts
export declare class NotImplementedError extends Error { constructor(member: string); }

// src/seams/registry.ts
export interface CoreServices {
  project: ProjectService; engine: EngineService; storage: StorageService;
  media: MediaImportService; exporter: ExportService; midi: MidiInputService;
  osc: OscService; recording: RecordingService; plugins: PluginService;
}
export declare function createCoreServices(env: PlatformEnv): Promise<CoreServices>;

export interface PlatformEnv { crossOriginIsolated: boolean; features: FeatureSet }
export interface FeatureSet {           // produced by src/platform/features.ts
  opfs: boolean; fsAccessPickers: boolean; webMidi: boolean; webSerial: boolean;
  setSinkId: boolean; playbackStats: boolean; offlineSuspend: boolean;
  audioEncoder: { opus: boolean; aac: boolean };
}

/** @impl src/core/model/service.ts — project-model.md */
export interface ProjectService {
  current(): ProjectDoc | null;
  subscribe(listener: (doc: ProjectDoc, change: ChangeSet) => void): () => void;
  dispatch(cmd: Command): CommandResult;
  undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
  beginGesture(label: string): GestureToken; endGesture(t: GestureToken): void;
  selection(): Selection; setSelection(s: Selection): void;
}

/** @impl src/core/engine/service.ts — audio-engine.md */
export interface EngineService {
  start(): Promise<void>;               // called from a user gesture
  state(): EngineState;
  onState(l: (s: EngineState) => void): () => void;
  transport: TransportControl;          // transport-and-timing.md
  meters(): MeterFeed;                  // mixer-and-routing.md
  panic(): void;                        // audio-safety.md
  acknowledgeSustainedLevel(): void;    // audio-safety.md
  setMasterGainDb(db: number): void;    // clamped, audio-safety.md
  setOutputDevice?(sinkId: string): Promise<void>; // present only if features.setSinkId
  safetyEvents(l: (e: SafetyEvent) => void): () => void;
}

/** @impl src/core/storage/service.ts — storage.md */
export interface StorageService {
  listProjects(): Promise<ProjectSummary[]>;
  open(id: ProjectId): Promise<OpenResult>;
  create(name: string): Promise<ProjectId>;
  remove(id: ProjectId): Promise<void>;
  estimate(): Promise<StorageEstimateInfo>;
  requestPersistence(): Promise<boolean>;
  clearAllData(): Promise<void>;
  importArchive(file: File): Promise<ImportReport>;          // project-file-format.md
  exportArchive(id: ProjectId, sink: ByteSink): Promise<void>;
}

/** @impl src/core/streaming/import-service.ts — audio-streaming.md, midi.md */
export interface MediaImportService {
  importAudio(files: File[]): AsyncIterable<ImportProgress>;
  importMidi(file: File): Promise<ImportReport>;
  importDawProject(file: File): Promise<ImportReport>;
}

/** @impl src/core/export/service.ts — export.md */
export interface ExportService {
  capabilities(): Promise<ExportCapabilities>;
  run(job: ExportJob, sink: ByteSink, signal: AbortSignal): AsyncIterable<ExportProgress>;
}

/** @impl src/core/midi/service.ts — midi.md */
export interface MidiInputService {
  requestAccess(): Promise<MidiAccessState>;
  inputs(): MidiPortInfo[];
  setEnabled(portId: string, on: boolean): void;
  keyboard: ComputerKeyboardInput;
}

/** @impl src/core/osc/service.ts — osc-web-serial.md */
export interface OscService {
  connect(port: SerialPortLike, opts: OscSerialOptions): Promise<void>;
  disconnect(): Promise<void>;
  status(): OscStatus;
}

/** @impl src/core/recording/service.ts — recording.md */
export interface RecordingService {
  listInputs(): Promise<AudioInputInfo[]>;
  arm(trackId: TrackId, input: InputSelection): Promise<void>;
  disarm(trackId: TrackId): void;
  calibrate(signal: AbortSignal): AsyncIterable<CalibrationProgress>;
  setMonitoring(trackId: TrackId, m: MonitoringSettings): void;
}

/** @impl src/core/plugins/service.ts — plugins-wam.md */
export interface PluginService {
  installFromFiles(source: File[] | FileSystemDirectoryHandle): Promise<InstalledPlugin>;
  list(): Promise<InstalledPlugin[]>;
  uninstall(id: string, version: string): Promise<void>;
  openEditor(deviceId: DeviceId, container: HTMLElement): Promise<() => void>;
}

/** Write target. Scaffolding supplies an FSA writable stream or OPFS staging plus download. */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  seek?(position: number): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}
```

## Scaffolding obligations
- Feature detection populates `FeatureSet` before `createCoreServices()` runs.
- The UI blocks engine start when `crossOriginIsolated` is `false` and states the requirement.
- File pickers, settings screens, routing and state stores call seams only.
