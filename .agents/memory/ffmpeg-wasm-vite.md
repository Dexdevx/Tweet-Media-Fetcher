---
name: FFmpeg.wasm in browser (Vite)
description: Getting @ffmpeg/ffmpeg 0.12.x to load and run in a Vite React app without cross-origin isolation.
---

# Running @ffmpeg/ffmpeg 0.12.x client-side under Vite

Two separate gotchas must BOTH be fixed or the renderer hangs/errors at load.

## 1. Use the ESM core build, not UMD
@ffmpeg/ffmpeg@0.12.x creates its internal Web Worker as a **module worker**
(`new Worker(url, { type: "module" })`). A module worker cannot call
`importScripts`, so the worker falls back to `self.createFFmpegCore = (await import(coreURL)).default`.

- Only `@ffmpeg/core/.../dist/esm/ffmpeg-core.js` provides `export default createFFmpegCore`.
- The `/dist/umd/` build exposes `module.exports`/a global, so `.default` is `undefined`
  → throws `ERROR_IMPORT_FAILURE` = "failed to import ffmpeg-core.js".

So `toBlobURL(...)` the **esm** core + esm wasm. The old "UMD core via toBlobURL"
recipe only worked on older (classic-worker) ffmpeg versions like 0.12.6.

**Why:** the 0.12 line switched the worker to type:"module"; copy-pasted UMD recipes
silently break with a misleading import error.

## 2. Exclude the packages from Vite dep optimization
Vite's dep optimizer rewrites the worker path and breaks it
(`worker.js does not exist in .vite/deps`). The renderer hangs forever at
"Loading renderer".

Fix in `vite.config.ts`:
```ts
optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] }
```

## 3. Single-threaded core for Replit preview
Use the single-threaded core so it works when `crossOriginIsolated === false`
(the Replit preview iframe sets no COOP/COEP). Confirmed `coi=false` in the
preview; the ST core still loads and encodes. Do not reach for the `-mt` core.
