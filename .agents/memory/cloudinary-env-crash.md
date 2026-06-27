---
name: Cloudinary CLOUDINARY_URL boot crash
description: Why the Cloudinary SDK can crash the whole API server at boot and how to make it resilient.
---

# Cloudinary CLOUDINARY_URL boot crash

The `cloudinary` Node SDK parses `process.env.CLOUDINARY_URL` at **module import time**
(inside `cloudinary/lib/config.js`). If the value is malformed it `throw`s during
import — so a static `import { v2 } from "cloudinary"` at the top of a route file
takes the **entire API server down on boot**, not just the feature.

**Why:** users frequently paste a broken value. Two real mistakes seen:
1. Pasting the whole line `CLOUDINARY_URL=cloudinary://...` (the `CLOUDINARY_URL=`
   prefix becomes part of the value → "Invalid CLOUDINARY_URL protocol").
2. Leaving the docs placeholder angle brackets: `cloudinary://<key>:<secret>@<cloud>`
   → boots fine but every API call returns 401 "unknown api_key" because the key
   is literally `<key>` (URL-encoded as `%3C...%3E`).

**How to apply:**
- Import the SDK **lazily** via dynamic `await import("cloudinary")` inside a
  try/catch, behind a cached promise — never a top-level static import. A bad
  secret then only disables that feature (return 503) instead of crashing boot.
- **Sanitize** the env value before use: trim, strip surrounding quotes, strip a
  leading `CLOUDINARY_URL=`, and strip `<`/`>` (a valid URL never contains them).
  Write the cleaned value back to `process.env.CLOUDINARY_URL` before importing so
  the SDK's import-time parse succeeds.
- To verify credentials without printing the secret: `cloudinary.api.ping()` →
  `{status:"ok"}`. A 401 "unknown api_key" almost always means leftover `<>`.

# Cloudinary temp-asset cleanup
In-memory `setTimeout(destroy, 5min)` is the fast path but leaks assets if the
process restarts before it fires. Pair it with a periodic sweep that lists the
temp folder (`api.resources({prefix, resource_type})`) and destroys anything past
its TTL. Run the sweep for **both** `resource_type:"video"` and `"image"`.
