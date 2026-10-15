# OSC over Web Serial

## Transport
- `navigator.serial.requestPort()` from a user action, then `port.open({ baudRate })`. Default baud rate 115 200 (project limit).
- Framing: SLIP (RFC 1055), double-END as specified for stream transports in OSC 1.1.

| SLIP byte | Value |
|---|---|
| END | 0xC0 |
| ESC | 0xDB |
| ESC_END | 0xDC |
| ESC_ESC | 0xDD |

## Messages
- OSC 1.0 message and bundle encoding. Supported type tags: `i`, `f`, `s`, `b` (OSC 1.0 required set) and `T`, `F` (required in OSC 1.1). Messages with other tags are ignored and counted.
- Packets ≤ 1024 bytes (project limit); larger frames are discarded.
- Inbound rate ≤ 500 messages/s (project limit); excess is dropped.

| Address | Arguments | Action |
|---|---|---|
| `/w-rack/transport/play` | — | Play |
| `/w-rack/transport/stop` | — | Stop |
| `/w-rack/transport/locate` | `f` beats | Locate |
| `/w-rack/panic` | — | Panic |
| `/w-rack/track/{index}/gain` | `f` dB | Set gain, clamped |
| `/w-rack/track/{index}/pan` | `f` [−1, 1] | Set pan |
| `/w-rack/track/{index}/mute` | `T`/`F` or `i` | Mute |
| `/w-rack/note` | `i` pitch, `i` velocity | Note to the selected track; velocity 0 is note-off |

- Parameter messages become undoable commands with `coalesceKey` equal to the address.
- Outbound transport state is sent at most every 100 ms (project limit).

```ts
export interface OscSerialOptions { baudRate: number }
export type OscStatus = { state: 'disconnected' | 'connecting' | 'connected' | 'error'; rxCount: number; dropped: number };
export interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null; writable: WritableStream<Uint8Array> | null;
  close(): Promise<void>;
}
```

## Platform
- Chromium desktop 89+. Firefox desktop 151+ with add-on gating, disabled by default under Enterprise Policies. Safari: unsupported; the feature is hidden when `features.webSerial` is false.

## Sources
- Web Serial API — https://wicg.github.io/serial/
- Freed and Schmeder, "Features and Future of Open Sound Control version 1.1 for NIME" (2009) — https://opensoundcontrol.stanford.edu/files/2009-NIME-OSC-1.1.pdf
- RFC 1055 — https://www.rfc-editor.org/rfc/rfc1055
- Mozilla Hacks, Web Serial in Firefox — https://hacks.mozilla.org/2026/05/web-serial-support-in-firefox/
