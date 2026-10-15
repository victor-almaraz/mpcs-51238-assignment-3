# Audio streaming

## Decoding
| Input | Path |
|---|---|
| WAV (PCM 8/16/24/32-bit, float 32/64), `WAVE_FORMAT_EXTENSIBLE`, RF64/BW64, AIFF, AIFF-C (`NONE`, `sowt`, `fl32`) | Core parsers in the disk worker |
| FLAC, MP3, Ogg (Vorbis, Opus), M4A (AAC, ALAC) | Mediabunny demux and WebCodecs `AudioDecoder` in the disk worker, when `AudioDecoder.isConfigSupported()` reports support |
| Compressed input the disk worker cannot decode | `decodeAudioData` on the main thread; decoded size ≤ 512 MiB (project limit) |

- Decoded audio is resampled offline to the context rate in the disk worker. The resampler is core DSP: windowed sinc, stopband ≥ 100 dB (project limit).
- Unsupported inputs produce an `ImportReport` error; no Source is added.

## Source cache
- Path: `/cache/<sourceId>/<sampleRate>.f32`.
- Header: 64 bytes — magic `WRCF`, version, channels, frames, sample rate, first 16 bytes of the source SHA-256.
- Body: chunks of 65 536 frames (project limit); within a chunk, channels are stored one after another as float32.
- A cache is valid only when its sample rate and source hash match. Otherwise it is regenerated.

## Streaming
| Parameter | Value (project limits) |
|---|---|
| Ring per streaming voice | SAB, 2 s at context rate, per channel |
| Refill threshold | < 1 s buffered |
| Read size | One chunk |
| Head cache | First 0.5 s from every clip start, resident in the engine |
| Resident memory | ≤ 256 MiB for head caches and rings |
| Concurrent streaming voices | 64 |

- Playback starts from the head cache while the ring fills.
- On ring underrun the voice fades to silence over 5 ms and the engine counts a stream underrun.
- Locate: the engine sends `seek` to the disk worker, which resets ring indices and refills. Playback resumes once every voice has 0.25 s buffered or is inside its head cache.

```ts
export interface StreamRing {
  sab: SharedArrayBuffer;  // SPSC layout, audioworklet-and-wasm.md
  channels: number; capacityFrames: number;
}
export type DiskMsg =
  | { t: 'open'; voiceId: number; sourceId: SourceId; startFrame: Frames; ring: StreamRing }
  | { t: 'seek'; voiceId: number; frame: Frames }
  | { t: 'close'; voiceId: number };
export type ImportProgress =
  | { kind: 'decoding' | 'caching' | 'peaks'; file: string; fraction: number }
  | { kind: 'done'; sourceId: SourceId } | { kind: 'failed'; file: string; message: string };
```

## Peaks
- Min/max pairs as int16 per channel at 256, 1024, 4096 and 16 384 frames per pair (project limit).
- File `/cache/<sourceId>/peaks.bin`; its header lists levels and offsets.
- Generated during import from the decoded stream in one pass.

## Failure modes
| Failure | Behaviour |
|---|---|
| Cache missing at playback | Clip plays silent and shows "Preparing"; the cache is generated in the background |
| OPFS read error | Voice muted; error shown; transport continues |

## Unconfirmed
- `AudioDecoder` support for FLAC, Vorbis and ALAC in each engine.

## Sources
- WebCodecs — https://www.w3.org/TR/webcodecs/
- Mediabunny supported formats — https://mediabunny.dev/guide/supported-formats-and-codecs
- File System Standard — https://fs.spec.whatwg.org/
