---
name: Cloudinary on-demand cleanup
description: Why the on-demand asset-delete endpoint needs a signed token, and how Cloudinary's destroy() reports misses.
---

# On-demand cleanup of temporary Cloudinary assets

An endpoint that deletes a render's temporary Cloudinary assets on demand must not
identify them by public ID alone. The render response returns an HMAC
`cleanupToken` binding both public IDs; cleanup re-derives and compares it
(constant-time) before destroying.

**Why:** the endpoint is unauthenticated and assets live in a shared temp folder
(`xmd_tmp/`). With IDs alone, anyone who learns valid IDs could delete another
user's render before its ~5-min auto-expiry. The prefix check stops arbitrary
deletion but not cross-user deletion within the temp namespace.

**How to apply:** sign with `SESSION_SECRET` (fall back to a per-process random
key — fine because tokens only need to outlive the ~5-min asset TTL). Keep the
existing `xmd_tmp/` prefix check too; the token is an *additional* gate.

## Gotcha: destroy() doesn't throw on a missing asset

`cloudinary.uploader.destroy()` resolves with `{ result: "ok" | "not found" | ... }`
instead of rejecting when the asset is already gone. To report a truthful
`deleted` flag, inspect `result` — treat both `"ok"` and `"not found"` as success
(already-expired counts as deleted) and only return non-2xx when a destroy
genuinely fails.
