# Storage

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
Database `w-rack`, object stores: `settings`, `projectIndex`, `pluginIndex`, `fsaHandles` (Chromium linked folders). After a reload, a stored File System Access handle requires `requestPermission({ mode: 'readwrite' })` from a user action. Chromium offers an "Allow on every visit" choice in that prompt, which keeps the grant until the user revokes it.

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
- Opening a project requests the Web Lock `w-rack:project:<projectId>` with `ifAvailable: true`.
- If the lock is held, the project opens read-only with an option to take control, which uses `steal: true` after confirmation.

## Unconfirmed
- Whether the 7-day rule applies to W-Rack installed as a macOS web app (Add to Dock).

## Sources
- MDN Storage quotas and eviction criteria — https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- WebKit: Updates to storage policy — https://webkit.org/blog/14403/updates-to-storage-policy/
- MDN createSyncAccessHandle — https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle
- MDN Web Locks API — https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
