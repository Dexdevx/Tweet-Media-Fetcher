# X Media Downloader

Paste an X/Twitter post URL and instantly get downloadable video qualities and images from that post.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Frontend: `artifacts/media-downloader/` (React + Vite, single page at `src/pages/home.tsx`)
- API contract: `lib/api-spec/openapi.yaml` (source of truth — re-run codegen after edits)
- Extract route: `artifacts/api-server/src/routes/extract.ts`

## Architecture decisions

- The `/api/extract` endpoint proxies the public `tweeterdownloader.com` extraction API server-side to avoid browser CORS and to normalize/validate the response.
- Video captioning supports two render paths: **device** (FFmpeg.wasm, 720x1280, in-browser) and **cloud** (`POST /api/render-cloudinary`, 1080x1920 max quality). A toggle in the editor picks between them.
- The cloud path does NOT use Cloudinary text/logo layers (they choke on emoji/curly quotes — "Invalid encoding in transformation" — and Arial lacks emoji glyphs). Instead the browser renders the full-frame caption+logo overlay PNG (the same canvas code as the device path, at 1080x1920) and sends it as a data URL; Cloudinary just lays that PNG over the padded video. This guarantees the cloud output matches the on-device preview. See `.agents/memory/cloudinary-text-overlay.md`.
- Cloudinary assets are temporary: each render schedules a `destroy()` after 5 min, plus a periodic sweep deletes anything left in the `xmd_tmp` folder past TTL (free plan = limited credits). The Cloudinary SDK is imported lazily + the `CLOUDINARY_URL` value is sanitized — see `.agents/memory/cloudinary-env-crash.md`.
- Users can also delete a cloud render immediately via a "Delete from cloud" button after download (`POST /api/cleanup-cloudinary`). The render response returns the asset public IDs plus a signed `cleanupToken` (HMAC over both IDs, key = `SESSION_SECRET`); cleanup requires the token and an `xmd_tmp/` prefix so IDs alone can't delete another user's assets. See `.agents/memory/cloudinary-cleanup-token.md`.
- A logo can be uploaded from the device and dragged/resized at the video bottom (caption stays top); it is burned into BOTH render paths (drawn into the overlay PNG locally, overlaid via transformation on Cloudinary).
- Input is restricted to X/Twitter post URLs (host allowlist + `/status/{id}` path check); malformed or non-tweet URLs return 400.
- Upstream JSON is strictly validated; unexpected shapes or empty media return 502 rather than a misleading 200.
- Outbound fetch has a 20s timeout via AbortController.

## Product

- Single-purpose tool: paste an X/Twitter post link, extract downloadable media. Shows post title, thumbnail, duration, and one download link per video quality plus any images.
- Clicking a video quality opens an in-app player (Radix Dialog) that plays the video and overlays the tweet text. The overlay is draggable, double-click-to-edit (textarea), resizable via a bottom-right handle, and has alignment + full-width controls. Defaults to full-width, centered, near the top. Download and quality-switch controls live in the player header.

## Gotchas

- Overlay edit mode uses Escape to exit; Radix Dialog also closes on Escape. The overlay reports its editing state up via a ref so `DialogContent.onEscapeKeyDown` can `preventDefault()` while editing. See `.agents/memory/radix-dialog-escape.md`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
