# Repo structure

## Layout
```
w-rack/
  index.html
  vite.config.ts            # scaffolding
  tsconfig*.json            # scaffolding
  public/
    _headers                # host header file; contents per privacy-and-security.md
    fonts/                  # self-hosted fonts
  src/
    main.tsx                # scaffolding entry
    app/                    # scaffolding: shell, routes, screens
    ui/                     # scaffolding: components, canvas views
    state/                  # scaffolding: UI stores
    platform/               # scaffolding: feature detection, pickers, permissions
    seams/                  # core: seam interfaces, registry, errors
    core/                   # core: core-and-scaffolding.md
    worklets/               # core: engine, segment, safety, capture processors
    workers/
      disk.worker.ts        # core
      export.worker.ts      # core
      render.worker.ts      # scaffolding
    sw/sw.ts                # scaffolding: service worker, built to /sw.js
  wasm/                     # core: DSP sources and build script
  tests/
    core/                   # core: unit tests (Vitest, Node)
    engine/                 # core: render tests (Playwright, real browsers)
    harness/                # scaffolding: fixtures, WAV comparison, helpers
    e2e/                    # scaffolding: UI flows
  scripts/                  # scaffolding: CI scans, build helpers
  docs/
```

## Build rules
| Rule | Value |
|---|---|
| Worklet modules | Imported with `?url`, emitted as separate files, loaded by `audioWorklet.addModule(url)`. Inline and `blob:` worklets are not used for W-Rack code. |
| Workers | Module workers via `new URL(..., import.meta.url)` |
| WASM | Emitted as `.wasm` assets; compiled on the main thread (`audioworklet-and-wasm.md`) |
| Asset inlining | `build.assetsInlineLimit: 0` (no `data:` URIs) |
| Module preload polyfill | `build.modulePreload.polyfill: false` |
| Service worker | Separate entry at the site root, outside hashed asset folders |
| Output | `dist/` contains static files only |

## Development server
- `server.headers` sets COOP, COEP and CORP as in production.
- The development server does not send the production CSP: Vite injects inline scripts and styles for hot module replacement. CSP is verified against `pnpm build` output served by `pnpm preview`, which sends the production headers.

## Commands
| Command | Purpose |
|---|---|
| `pnpm dev` | Development server with cross-origin isolation headers |
| `pnpm build` | Production build |
| `pnpm preview` | Serves `dist/` with production headers |
| `pnpm test` | Vitest (`tests/core`, `tests/harness`) |
| `pnpm test:engine` | Playwright render tests in Chromium, Firefox, WebKit |
| `pnpm scan` | Third-party URL and tracking-API scan (`privacy-and-security.md`) |

## Sources
- Vite build options — https://vite.dev/config/build-options
- Vite server options — https://vite.dev/config/server-options
