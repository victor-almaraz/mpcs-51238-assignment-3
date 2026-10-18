# AudioWorklet and WASM

## Worklet module rules
- Wrack modules load as same-origin files through `audioWorklet.addModule(url)`.
- `AudioWorkletGlobalScope` has no `fetch`, no `Response` (so no `WebAssembly.compileStreaming`) and no `performance`. Processor code does not use `TextEncoder` or `TextDecoder`; strings cross into the audio thread as pre-encoded bytes.
- `process()` returns `true`.
- The hot path performs no allocation, closure creation or structured-data `postMessage`.
- Block length is read from the output arrays, not assumed to be 128.
- Exceptions follow `audio-engine.md`.

## WASM loading
- The main thread calls `WebAssembly.compileStreaming(fetch(url))` and passes the `WebAssembly.Module` in `processorOptions`. The module is structured-cloned; the worklet is in the same agent cluster.
- The processor instantiates it synchronously in its constructor, before the first `process()`.
- Audio crosses into WASM through a fixed region of WASM linear memory per quantum.
- Compilation requires `'wasm-unsafe-eval'` in `script-src` (`privacy-and-security.md`).
- Threaded WASM is not used.
- The same WASM modules run in the export worker (ADR-10).

## SharedArrayBuffer layouts
```ts
/** Single-producer single-consumer ring. Indices are u32 frame counts that wrap modulo 2^32. */
export interface SpscRingLayout {
  headerBytes: 64;            // Int32[0] writeIndex, Int32[1] readIndex (via Atomics); rest reserved
  channels: number;
  capacityFrames: number;     // power of two
}
/** Float64Array(4): frame, tick, contextTime, version. */
export type PlayheadBlock = Float64Array;
/** Float32Array: per meter target, the MeterReading fields in declaration order (mixer-and-routing.md). */
export type MeterBlock = Float32Array;
```
- The producer writes data, then `Atomics.store` on the write index. The consumer `Atomics.load`s the write index before reading data.
- The audio thread never calls `Atomics.wait`.
- Rings are allocated on the main thread and passed once at setup.

## Unconfirmed
- Structured cloning of `WebAssembly.Module` through `processorOptions` in Safari.

## Sources
- MDN Using AudioWorklet — https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet
- Chrome: audio worklet design pattern — https://developer.chrome.com/blog/audio-worklet-design-pattern
- MDN WebAssembly.compileStreaming — https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/compileStreaming_static
