# Export

## Render paths
| Project | Path | Length limit |
|---|---|---|
| No WAM plugins | Export worker runs engine and safety kernels block by block and streams output to the disk worker | Storage quota only |
| WAM plugins, `OfflineAudioContext.suspend()` available | `OfflineAudioContext` with the full graph including `SafetyProcessor`; a `CaptureProcessor` streams output to the disk worker; the destination has one channel; rendering suspends every 1 s of audio to drain the ring (project limit) | 30 min (project limit) |
| WAM plugins, no `suspend()` (Firefox) | `OfflineAudioContext` with a stereo destination; output read from the rendered `AudioBuffer` | 10 min (project limit) |

- Memory for `OfflineAudioContext` renders is frames × channels × 4 bytes. It is checked against available memory and quota before start.
- Progress is a fraction where the path reports it, otherwise indeterminate.
- All paths render at the context sample rate and pass through the safety stage.

```ts
export type ExportJob =
  | { kind: 'mix'; range: TickRange; format: AudioFormat; tailMs: number }
  | { kind: 'stems'; range: TickRange; format: AudioFormat; trackIds: TrackId[]; tailMs: number }
  | { kind: 'midi' } | { kind: 'dawproject' } | { kind: 'archive' };
export type AudioFormat =
  | { container: 'wav'; encoding: 'pcm16' | 'pcm24' | 'float32'; dither: boolean }
  | { container: 'ogg' | 'webm'; codec: 'opus'; bitrate: number }
  | { container: 'mp4' | 'adts'; codec: 'aac'; bitrate: number };
export type ExportProgress =
  | { fraction: number | null; stage: 'render' | 'encode' | 'write' }
  | { done: true; bytes: number };
export interface ExportCapabilities { wav: true; opus: boolean; aac: boolean; progress: boolean }
```

## WAV writer
| Encoding | Header |
|---|---|
| PCM 16-bit, 1–2 channels | 44-byte canonical header (`fmt ` tag 1, size 16) |
| PCM 24-bit, or more than 2 channels | `WAVE_FORMAT_EXTENSIBLE` (`fmt ` size 40, subformat PCM) |
| IEEE float 32-bit | Tag 3, `fmt ` size 18 (`cbSize` 0), plus `fact` chunk; 58-byte header |
| Data larger than 4 GiB | RF64 with `ds64` chunk |

- Dither: TPDF, ±1 LSB, when reducing to 16 or 24 bits. The seed is fixed per export, so repeated exports are identical.
- Samples are clamped to [−1, 1) before integer conversion.

## Compressed formats
| Codec | Containers | Availability |
|---|---|---|
| Opus | Ogg, WebM | Offered when `AudioEncoder.isConfigSupported()` reports support |
| AAC | MP4, ADTS | Offered when supported; unavailable in Firefox and on desktop Linux |

- MP3 and FLAC encoding are not offered.
- Muxing uses Mediabunny (ADR-9).

## Stems
- A stem is one track rendered solo through its full chain to the safety stage, one render per stem.
- File names: `<project>-<nn>-<track>.<ext>`, sanitized.

## MIDI, DAWproject, archive
- SMF export: `midi.md`. DAWproject export and archives: `project-file-format.md`.

## Delivery
- `ByteSink`: File System Access `showSaveFilePicker` (Chromium), otherwise an OPFS staging file delivered by an `<a download>` link to a `blob:` URL created in `src/platform/download.ts`.

## Sources
- Microsoft/IBM, Multimedia Programming Interface and Data Specifications 1.0 (RIFF WAVE), 1991
- Microsoft, WAVEFORMATEXTENSIBLE — https://learn.microsoft.com/en-us/windows/win32/api/mmreg/ns-mmreg-waveformatextensible
- EBU Tech 3306 (RF64) — https://tech.ebu.ch/publications/tech3306
- MDN WebCodecs codec selection — https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection
- Mozilla bug 1265406 — https://bugzilla.mozilla.org/show_bug.cgi?id=1265406
