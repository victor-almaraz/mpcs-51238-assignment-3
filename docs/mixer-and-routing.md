# Mixer and routing

## Channel strip order
1. Source: instrument kernel, audio clips, or input monitor
2. Devices in `deviceIds` order
3. Pre-fader sends
4. Fader (`gainDb`)
5. Pan
6. Post-fader sends
7. Meter
8. Output

## Routing
- Track outputs go to a bus or to master. Sends go to buses.
- The routing graph is acyclic. A command that would create a cycle fails with `cycle`.
- Fader range: −∞ to +6 dB on tracks and buses (project limit). The master fader is capped at 0 dB (`audio-safety.md`).
- Send gain: −∞ to +6 dB (project limit).

## Pan
- Every channel strip has a pan control: instrument tracks, audio tracks, buses and the master.
- Range −1 (full left) to +1 (full right), default 0. The value is smoothed and automatable (`<trackId>/pan`, `automation.md`).

## Pan law
| Source | Law |
|---|---|
| Mono | Constant power: θ = (p + 1)·π/4, L = cos θ, R = sin θ; centre is −3.01 dB per side |
| Stereo | Balance: p < 0 scales R by (1 + p); p > 0 scales L by (1 − p); centre is unity |
| Master | Balance, as for stereo sources |

## Solo
Solo is solo-in-place. A track is audible when it is not muted and at least one holds:
- no track is soloed;
- it is soloed;
- it is `soloSafe`;
- it is on the routing path of a soloed track, upstream or downstream.

Buses default to `soloSafe = false`; buses created as send returns default to `soloSafe = true`.

## Metering
| Meter | Definition |
|---|---|
| Peak | Sample peak per channel; 1.5 s hold; 20 dB/s fall (project limits) |
| RMS | 300 ms window (project limit) |
| Loudness (master, optional) | ITU-R BS.1770-5 K-weighting; momentary 400 ms, short-term 3 s; integrated over 400 ms blocks with 75% overlap, −70 LUFS absolute gate, −10 LU relative gate |
| True peak (master, optional) | 4× oversampling per BS.1770-5 Annex 2 |

```ts
export interface MeterFeed { read(target: TrackId | 'master', out: MeterReading): void }  // SAB-backed
export interface MeterReading {
  peakDb: [number, number]; rmsDb: [number, number]; holdDb: [number, number];
  reductionDb?: number; lufsM?: number; lufsS?: number; lufsI?: number; truePeakDb?: number;
}
```

## Sources
- ITU-R BS.1770-5 — https://www.itu.int/rec/R-REC-BS.1770
- EBU R 128 — https://tech.ebu.ch/publications/r128
