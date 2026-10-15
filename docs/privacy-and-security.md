# Privacy and security

## Network policy
- After the initial load, the app requests only same-origin assets.
- No analytics, telemetry, crash or error reporting, fingerprinting or advertising.
- No CDNs, external scripts or remote fonts. Fonts are self-hosted in `public/fonts/`.
- Plugins load from same-origin installed copies only (ADR-8).
- Host analytics products are disabled. The host's request logs are outside app control and contain only static-asset requests.

## Response headers
All production responses carry:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self'; connect-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; manifest-src 'self'` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `midi=(self), serial=(self), microphone=(self), speaker-selection=(self), camera=(), geolocation=(), usb=(), hid=(), bluetooth=(), payment=(), display-capture=()` |
| `X-Content-Type-Options` | `nosniff` |

## Directive rationale
| Directive | Reason |
|---|---|
| `'wasm-unsafe-eval'` | Permits WebAssembly compilation without `'unsafe-eval'`. Supported in Chrome 97+, Firefox 102+, Safari 16+. |
| `blob:` in `script-src` | The WAM SDK environment setup (`addFunctionModule`) loads generated module text into the AudioWorklet. `'self'` never matches `blob:` URLs; without `blob:`, `addModule()` rejects with `AbortError`. |
| `worker-src 'self'` | Workers and the service worker are same-origin files. Worklet modules fall under `script-src`. |
| No `'unsafe-inline'` | Production HTML contains no inline scripts, inline styles or `style` attributes. React `style` props on the client set CSSOM properties, which `style-src` does not restrict. |
| `require-corp` | Safari does not support COEP `credentialless`. All resources are same-origin. |

## Inline-code rules
- Production build output contains no inline `<script>` or `<style>` and no `data:` URIs (`repo-structure.md`).
- W-Rack code creates `blob:` URLs only for file downloads (`export.md`), never for script content.
- Tailwind output ships as a stylesheet file.

## Cross-origin isolation
- `self.crossOriginIsolated === true` is required for `SharedArrayBuffer`.
- When it is `false`, the app shows a requirement screen and creates no `AudioContext`.

## Local data
| Store | Content |
|---|---|
| OPFS | Projects, Sources, caches, journals, installed plugins |
| IndexedDB | Settings, File System Access handles, project index, plugin index |
| Cache Storage | Service-worker application shell |

- No cookies, `localStorage` or `sessionStorage`.
- Settings provide "Clear all data", which removes OPFS, IndexedDB and Cache Storage and unregisters the service worker.

## Plugin trust
- WAM code runs with page privileges.
- Installation requires explicit confirmation that states this and shows the plugin's identifier, vendor, version and file count.
- An installed plugin cannot reach the network: `connect-src 'self'` applies to it.

## CI scans
`pnpm scan` fails the build when `dist/` contains:
- absolute `http(s)://` URLs outside an allowlist (license text);
- `navigator.sendBeacon`, or `fetch` / `XMLHttpRequest` with non-relative URLs;
- `document.cookie`, `localStorage` or `sessionStorage`;
- inline `<script>` or `on*=` attributes in HTML;
- `URL.createObjectURL` in W-Rack-authored chunks other than the download module (`src/platform/download.ts`).

A Playwright test asserts zero non-same-origin requests during a scripted session.

## Unconfirmed
- The exact `blob:` mechanism in `addFunctionModule` of the pinned `@webaudiomodules/sdk`. The build verifies it by loading the WAM environment under the production CSP (`testing-and-acceptance.md`).

## Sources
- CSP Level 3 — https://www.w3.org/TR/CSP3/
- HTML Standard: cross-origin opener and embedder policies — https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies
- WAM API — https://github.com/webaudiomodules/api
- WebAudio v2 issue 109 (worklet module loading and CSP) — https://github.com/WebAudio/web-audio-api-v2/issues/109
