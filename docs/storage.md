# Storage

This document describes the full storage design: OPFS, journals, linked folders and multi-tab locking. The Assignment 3 build implements none of these; it stores data as described in Assignment 3 build, and `assignment-3-scope.md` (Persistence, Audio persistence) takes precedence for it.

## Assignment 3 build
### Stores
| Data | Store | Location |
|---|---|---|
| Project document | `localStorage` | `wrack:v1:project:<id>` |
| Working state of one project | `localStorage` | `wrack:v1:view:<id>` |
| Project summaries | `localStorage` | `wrack:v1:index` |
| Preset library | `localStorage` | `wrack:v1:presets` |
| Saved settings | `localStorage` | `wrack:v1:settings` |
| Original bytes of imported audio | IndexedDB | database `wrack`, store `sources` |

- Only `src/lib/storage/storage.js` touches `localStorage`, and only `src/lib/storage/audio-store.js` touches IndexedDB.
- Project and working-state saves are separate debounced writes, each 500 ms after the last change and flushed on `pagehide` (project limit). A view change never rewrites the project document.
- Deleting a project removes its project document, working state and index entry.

### Project document and working state
The project document (`project-model.md`) holds the music and its settings: name, tempo, meter, tracks with names, colours, mixer settings and devices, clips and notes, source metadata and `audioRate`. It is the content of `project.json` in a `.wrack` archive, and editor edits to it are undoable (`project-model.md`, Commands and undo).

The working state holds how the editor shows the project. It is never archived, never part of undo history, and never includes the transport: a project always opens stopped. Master volume, keyboard octave and metronome on/off are saved settings, not part of either.

### Working-state fields
`normalizeView` in `src/lib/project/view-state.js` reads the stored value. A stored value that is not an object yields the defaults. Each field that is missing, outside its accepted values, or refers to a track or clip absent from the document takes its default; the other fields keep their stored values.

| Field | Accepted values | Default |
|---|---|---|
| `playhead` | Integer tick ≥ 0 | `0` |
| `loop` | `null`, or `{ start, end }` with integer ticks ≥ 0 and `end > start` | The document's `loop`, else `null` |
| `loopEnabled` | `true` only while `loop` is not `null`; any other value reads as `false` | `false` |
| `zoom` | Number from 0.25 to 8 (1 = 100 %; the UI steps by factors of 2) | `1` |
| `scrollX`, `scrollY` | Finite number ≥ 0, in CSS pixels | `0` |
| `selectedTrackId` | ID of a track in the document | `null` |
| `selectedClipIds` | Array; IDs of clips absent from the document are dropped | `[]` |
| `openPanel` | `'pianoroll'` or `'clip'` | `null` |
| `panelClipId` | ID of a clip in the document; read only when `openPanel` is valid | `null` |
| `dock` | `'editor'`, `'devices'` or `'mixer'` | `'editor'` |
| `dockCollapsed` | Boolean | `false` |
| `snap` | `'bar'`, `'1'`, `'0.5'` or `'0.25'` (quarter notes) | `'1'` |
| `snapOn` | Boolean | `true` |
| `armedTrackIds` | Array; IDs that are not instrument tracks in the document are dropped | `[]` |

- With `loop` `null`, the editor uses the first four bars as the loop range until a range is set.
- Unreadable stored working state falls back to the defaults and is replaced on the next view change.
- A `.wrack` file imported as a new project opens with the default working state. "Replace project" keeps the stored working state, normalized against the replacement document.

## OPFS layout
```
/projects/<projectId>/project.json
/projects/<projectId>/snapshots/<seq>.json
/projects/<projectId>/journal/<seq>.log
/projects/<projectId>/sources/<sourceId>.<ext>
/cache/<sourceId>/<sampleRate>.f32       # audio-streaming.md
/cache/<sourceId>/peaks.bin
/recordings/<sessionId>/<captureId>.f32  # captures in progress
/plugins/<pluginId>/<version>/...        # plugins-wam.md
/staging/<uuid>                          # export and archive staging
```
- Only the disk worker writes to OPFS, through `FileSystemSyncAccessHandle` with the default exclusive mode.

## IndexedDB
Database `wrack`, object stores: `settings`, `projectIndex`, `pluginIndex`, `fsaHandles` (Chromium linked folders). After a reload, a stored File System Access handle requires `requestPermission({ mode: 'readwrite' })` from a user action. Chromium offers an "Allow on every visit" choice in that prompt, which keeps the grant until the user revokes it.

## Persistence and quota
| Engine | Quota | Eviction |
|---|---|---|
| Chromium | Origin up to 60% of total disk | Least recently used origins under storage pressure, unless persistent |
| Firefox | Best-effort: 10% of disk or 10 GiB per site group, whichever is smaller. Persistent: up to 50% of disk, at most 8 TiB. | Least recently used under pressure, unless persistent |
| Safari 17+ (browser) | Origin up to 60% of disk; all origins up to 80% | Under pressure; with tracking prevention, all script-writable storage of an origin after 7 days without user interaction |

Requirements:
- Call `navigator.storage.persist()` once from a user action: the first save or first import. Show the result in Settings.
- When persistence is not granted, show "This browser may delete projects" with an export action.
- Remind the user to export a `.wrack` backup when a project has not been exported for 7 days (project limit) and either persistence is not granted or the browser is Safari. In Safari, the 7-day rule applies regardless of `persist()`.
- Before imports, recordings and exports, check `estimate()`. Refuse an operation whose estimated size exceeds free quota minus 10%.
- Every write handles `QuotaExceededError`: the operation aborts and partial files are removed.

## Service types
```ts
export interface ProjectSummary { id: ProjectId; name: string; modifiedAt: string; sizeBytes: number; lastExportedAt: string | null }
export type OpenResult =
  | { ok: true; doc: ProjectDoc; readOnly: boolean; recoveredRecords: number; discardedRecords: number }
  | { ok: false; error: 'not-found' | 'locked' | 'corrupt' | 'newer-schema'; message: string };
export interface StorageEstimateInfo { usageBytes: number; quotaBytes: number; persisted: boolean }
```

## Linked folders (Chromium)
- The user may link a folder through `showDirectoryPicker()` for import and export. The project of record stays in OPFS.
- No feature depends on linked folders.

## Multi-tab locking
- Web Locks: Chrome 69+, Firefox 96+, Safari 15.4+.
- Opening a project requests the Web Lock `wrack:project:<projectId>` with `ifAvailable: true`.
- If the lock is held, the project opens read-only with an option to take control, which uses `steal: true` after confirmation.

## Unconfirmed
- Whether the 7-day rule applies to Wrack installed as a macOS web app (Add to Dock).

## Sources
- MDN Storage quotas and eviction criteria — https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- WebKit: Updates to storage policy — https://webkit.org/blog/14403/updates-to-storage-policy/
- MDN createSyncAccessHandle — https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle
- MDN Web Locks API — https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
