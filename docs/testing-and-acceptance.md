# Testing and acceptance

## Test layers
| Layer | Tool | Scope |
|---|---|---|
| Core unit | Vitest (Node) | DSP kernels, tempo math, SMF, ZIP, model commands, migrations |
| Engine render | Playwright in Chromium, Firefox, WebKit | `OfflineAudioContext` and export-worker renders of the full graph |
| End-to-end | Playwright | UI flows, keyboard-only flows, header and network assertions |
| Accessibility | axe-core in Playwright; manual NVDA and VoiceOver passes per release | ARIA patterns, contrast |

## Engine render tests
- Renders at 48 kHz and 44.1 kHz with fixed seeds (`instruments.md`).
- Comparison against golden files: |Δ| ≤ 1e-5 for JavaScript kernels, ≤ 1e-4 for WASM kernels (project limits).
- For plugin-free projects, the export-worker and `OfflineAudioContext` paths produce output within the same tolerance.
- Every render asserts the safety acceptance criteria (`audio-safety.md`).
- Timed renders verify the real-time budgets (`audio-engine.md`).

## Acceptance per stage
| Stage | Criteria |
|---|---|
| 1 | Note onsets within ±1 frame of the tempo-map frame. Loop wrap sample-accurate. SMF round trip preserves notes, tempo and meter. Two WAV exports of the same project are bit-identical. A project survives a forced tab termination with ≤ 1 command lost. |
| 2 | A 60-minute stereo Source plays without underrun on reference hardware. Locate resumes within 250 ms. Peaks match decoded data. Fades and crossfades match their formulas within 1e-5. |
| 3 | Calibrated loopback recording aligns within ±1 ms. Ring overflow is reported. The feedback detector triggers on a synthetic feedback signal. |
| 4 | Solo and pan law match `mixer-and-routing.md`. Gain automation is sample-accurate. Loudness within ±0.1 LU on EBU Tech 3341 test signals. |
| 5 | The WAM environment and a reference WAM load under the production CSP from an installed copy, with zero cross-origin requests. A plugin `processorerror` mutes only its device. DAWproject round trip reports all lossy items. The SLIP decoder handles every RFC 1055 escape case. |

## CI
- Every pull request runs `pnpm build`, `pnpm scan`, `pnpm test` and `pnpm test:engine`.
- Response headers are verified against `privacy-and-security.md` on a preview deployment.

## Sources
- MDN OfflineAudioContext — https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext
- EBU Tech 3341 — https://tech.ebu.ch/publications/tech3341
- Playwright — https://playwright.dev/
