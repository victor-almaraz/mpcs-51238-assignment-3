# Project file format

This document describes the full archive design. The `.wrack` files this build writes and reads follow the STORE-only subset in `assignment-3-scope.md` (`.wrack` archive): `project.json` and `audio/<sourceId>.<ext>`, no compression, manifest or ZIP64, and the limits listed there.

In this build, `project.json` is the project document exactly as stored in `localStorage` (`project-model.md`), and `audio/<sourceId>.<ext>` holds the original bytes of each source the document references, at the path in its `SourceRef`. The archive carries no working state (playhead, loop range and loop on/off, zoom, scroll, selection, open panel, dock, snap, armed tracks), no settings and no presets (`storage.md`, Assignment 3 build). Opening checks that each audio entry's SHA-256 equals its `sourceId`.

## Archive layout (`.wrack`)
```
manifest.json               # { "format": "w-rack.archive", "version": 1, "createdBy": "...", "projectFile": "project.json" }
project.json                # ProjectDoc (project-model.md)
sources/<sourceId>.<ext>    # original files, unmodified
plugin-state/<deviceId>.bin # plugin state larger than 64 KiB (project limit)
```
Source caches, peaks, journals and installed plugin code are not archived.

## ZIP rules
| Rule | Value |
|---|---|
| Compression | STORE for audio; DEFLATE via `CompressionStream('deflate-raw')` for JSON |
| CRC-32 | Computed by core code for every entry |
| Streaming write | Local headers with data descriptor (general-purpose flag bit 3) |
| ZIP64 | Used when any size or offset ≥ 0xFFFFFFFF or the entry count ≥ 0xFFFF |
| File names | UTF-8 (flag bit 11); forward slashes; relative |
| Write target | `ByteSink` (`core-and-scaffolding.md`) |
| Read | Central directory parsed first; entries read through `File.slice()` |

## Untrusted-input defenses
Imported archives, DAWproject files and SMF files are untrusted.

| Check | Limit (project limits) |
|---|---|
| Entry count | ≤ 10 000 |
| `project.json` uncompressed size | ≤ 64 MiB |
| Deflate ratio | ≤ 100:1 per entry; decompression aborts on overrun |
| Total uncompressed size | ≤ free quota from `navigator.storage.estimate()` minus 10% |
| Paths | Reject absolute paths, `..` segments, backslashes, drive letters, NUL, names > 255 bytes |
| Duplicates | Reject duplicate names, including case-insensitive duplicates |
| Header consistency | Local header name, method and flags match the central directory. Sizes and CRC are compared with the central directory, or with the data descriptor when flag bit 3 is set. |
| JSON | Depth ≤ 64; validated against the schema; unknown fields preserved in `extensions` |
| XML (DAWproject) | DOCTYPE and external entities rejected; depth ≤ 128; element count ≤ 1 000 000 |

A validation failure produces an `ImportReport` with errors and imports nothing.

```ts
export interface ImportReport {
  ok: boolean; projectId?: ProjectId;
  errors: { code: string; path?: string; message: string }[];
  lossy: { feature: string; detail: string }[];
}
```

## DAWproject mapping
| DAWproject | W-Rack | Loss |
|---|---|---|
| Timeline `timeUnit` `beats` | Ticks: beats × 960, rounded | Sub-tick positions rounded |
| Timeline `timeUnit` `seconds` | Ticks through the imported tempo map | Sub-tick positions rounded |
| `Transport/Tempo`, `TimeSignature` | `tempo[0]`, `meter[0]` | None |
| Tempo automation: `Points` of `RealPoint` with `interpolation` `linear` or `hold` | `tempo[]` with `shape` `linear` or `step` | None |
| `Structure/Track` (audio, notes) | `Track` of kind `audio` / `instrument` | None |
| Group tracks | `Track` of kind `bus` | Nested folders flattened |
| `Channel` volume, pan, mute, solo | `gainDb`, `pan`, `mute`, `solo` | Volume converted from linear to dB; pan law differences reported |
| Sends | `Send` | — |
| Clips with notes | `MidiClip` | Note expressions dropped |
| Clips with audio | `AudioClip` | Warp markers dropped |
| Nested timelines and lanes | Flattened clips | Structure flattened |
| Automation points | `AutomationLane` | Unsupported targets dropped |
| `ClapPlugin`, `Vst2Plugin`, `Vst3Plugin`, `AuPlugin` | Device marked missing; state kept in `extensions` | Native plugins unsupported |
| `metadata.xml` | `name`, `extensions` | Partial |

- Export writes `project.xml` (`<Project version="1.0">`), `metadata.xml` and audio files.
- W-Rack-only data is omitted, and the export report lists it.

## Sources
- DAWproject — https://github.com/bitwig/dawproject
- PKWARE APPNOTE.TXT — https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
- Compression Streams — https://compression.spec.whatwg.org/
