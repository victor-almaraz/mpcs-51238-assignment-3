# Recording

## Input selection
- `enumerateDevices()` lists `audioinput` devices; labels appear after microphone permission is granted.
- Capture constraints:

```ts
const constraints: MediaStreamConstraints = { audio: {
  deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false,
  autoGainControl: false, channelCount: { ideal: 2 } } };
```

```ts
export interface AudioInputInfo { deviceId: string; label: string; channelCount?: number }
export interface InputSelection { deviceId: string; channels: number[] }   // 0-based; 1 or 2 channels
export interface MonitoringSettings { enabled: boolean; gainDb: number }    // gainDb ≤ 0; default −12
```

- Chromium resamples input whose device rate differs from the context rate. Firefox rejects the connection with `NotSupportedError`. On that error, the UI states both rates and instructs the user to set the input device to the context rate.

## Capture
- Path: `MediaStreamAudioSourceNode → CaptureProcessor`, before any monitoring processing.
- `CaptureProcessor` writes to a SAB ring (4 s, project limit). The disk worker drains it to `/recordings/...`.
- The first captured frame is timestamped with the `currentFrame` of its quantum.
- Clip placement: first captured frame − calibrated round-trip latency − playback path latency (`audio-engine.md`).
- Master capture uses a `CaptureProcessor` after `SafetyProcessor`.
- Ring overflow ends the take and reports the number of dropped frames.

## Latency calibration
1. The user confirms a loopback: an interface cable, or speaker to microphone at low level.
2. The engine plays five probes: 50 ms logarithmic chirps at −20 dBFS, 500 ms apart (project limits).
3. Cross-correlation of captured input with the probe gives each lag in frames.
4. The result is accepted when the five lags differ by ≤ 1 ms (project limit). The median is stored per (input device, output device, sample rate).
5. Without calibration, compensation uses `baseLatency + outputLatency` plus the input track's reported `latency`, and the UI marks it uncalibrated.

Browser-reported latency is not reliable: `outputLatency` can read 0 until audio flows, `MediaTrackSettings.latency` is often constant, and Bluetooth devices under-report.

## Monitoring
- Monitoring passes the input through the track's channel strip.
- Enabling monitoring requires confirming that headphones are in use.
- Feedback detector: when monitored input RMS above −20 dBFS rises faster than 6 dB/s for 1 s, monitoring mutes and a warning appears (project limits).

## Takes
- Each pass creates one Source and one `AudioClip` per armed track.
- Overlapping passes share a `takeGroup`. The newest take plays; earlier takes are muted. Comping is outside stage 3.

```ts
export type CalibrationProgress =
  | { kind: 'probe'; index: number; lagFrames?: number }
  | { kind: 'done'; roundTripFrames: number; spreadMs: number }
  | { kind: 'failed'; reason: 'no-signal' | 'unstable' | 'clipped' };
```

## Unconfirmed
- Safari behaviour when the input device and context sample rates differ.

## Sources
- Media Capture and Streams — https://www.w3.org/TR/mediacapture-streams/
- Web Audio API 1.1 — https://www.w3.org/TR/webaudio-1.1/
- openDAW issue 374 (capture timing) — https://github.com/andremichelle/openDAW/issues/374
