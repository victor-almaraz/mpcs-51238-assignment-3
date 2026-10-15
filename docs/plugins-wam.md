# Plugins (WAM 2.0)

## Installation
1. The user selects a ZIP file or folder.
2. The disk worker validates it: a descriptor JSON and an ES module entry exist; path and size rules from `project-file-format.md` pass; total size ≤ 200 MiB (project limit).
3. The user confirms installation (`privacy-and-security.md`).
4. Files are copied to `opfs:/plugins/<identifier>/<version>/` and recorded in IndexedDB `pluginIndex`.

```ts
export interface InstalledPlugin { id: string; version: string; name: string; vendor: string; entry: string; isInstrument: boolean; installedAt: string }
```

## Loading
- The service worker serves `/plugins/<id>/<version>/<path>` from OPFS with the correct MIME type and `Cross-Origin-Resource-Policy: same-origin`.
- The host pins one version of `@webaudiomodules/api` and `@webaudiomodules/sdk`. Signatures follow that version's `types.d.ts`.
- Host setup, once per context: load the WAM environment into the AudioWorklet with the SDK's `addFunctionModule` (requires `blob:` in `script-src`, `privacy-and-security.md`), then a `WamGroup` with `groupId` and `groupKey`. `groupKey` comes from `crypto.getRandomValues` and is never passed to plugins.
- Instance creation: `const { default: WAM } = await import(url)`; verify `WAM.isWebAudioModuleConstructor`; call `WAM.createInstance` with `groupId`, the context and the initial state, as declared in the pinned `types.d.ts`.
- The plugin's audio node is inserted as a segment boundary (`audio-engine.md`).

## Events
- The sequencer sends MIDI events to instrument plugins through the `WamGroup` on the audio thread, one quantum ahead, timestamped in context seconds.
- Event connections exist only inside the host's `WamGroup`.
- Automation uses WAM automation events (`automation.md`). Transport events are sent on play, stop, locate and tempo change.

## Failure isolation
| Failure | Behaviour |
|---|---|
| Import or instantiation error | Device marked failed; the strip bypasses it |
| `processorerror` on the plugin node | Node disconnected; device bypassed; user notified |
| Non-finite output | The downstream segment's input guard mutes the device (`audio-safety.md`) |
| Plugin missing on project load | Device kept with its state, bypassed and marked missing |

## State and latency
- Plugin state is saved with `getState()` into `PluginDevice.state` and restored with `setState()`.
- The host does not rely on plugin-reported latency. Latency is measured at instantiation by passing an impulse through a separate instance in an `OfflineAudioContext`, or entered by the user, and stored in `PluginDevice.latencyFrames`.

## Unconfirmed
- Whether the WAM API or its extensions report plugin latency.
- Service-worker interception of http(s) worklet module fetches in Firefox and Safari. Chromium intercepts them; page-level dynamic `import()` is intercepted in all engines.

## Sources
- WAM API — https://github.com/webaudiomodules/api
- WAM documentation — https://www.webaudiomodules.com/docs/intro/
- Buffa et al., "Web Audio Modules 2.0: An Open Web Audio Plugin Standard," WWW '22 Companion — https://dl.acm.org/doi/10.1145/3487553.3524225
