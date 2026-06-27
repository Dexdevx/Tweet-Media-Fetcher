---
name: Cloudinary text overlays fail on emoji / special chars
description: Why we burn captions client-side as a PNG instead of using Cloudinary l_text layers.
---

# Cloudinary text/logo layers vs. a pre-rendered overlay PNG

Cloudinary `l_text:` (the SDK `overlay: { text, font_family, ... }`) returns
**HTTP 400 `x-cld-error: Invalid encoding in transformation`** when the caption
contains emoji or some non-ASCII punctuation (curly apostrophe `’`, `‼️`, `🤯`).
The failure happens at **delivery time** on the `res.cloudinary.com` URL, not at
upload — the upload succeeds and only the transformed download 400s. Even when it
doesn't error, the default fonts (Arial) have no emoji glyphs, so output wouldn't
match an HTML5-canvas preview anyway.

**Decision:** the cloud render path does NOT send text/logo for Cloudinary to
render. The browser renders the entire 9:16 overlay (caption + logo) with the
same canvas code as the device path, at the cloud output size (1080x1920), and
sends it as a PNG data URL. The server uploads that PNG and the transformation is
just: pad video to black 9:16 frame → `overlay` the PNG full-frame
(`l_<id>`, w/h = frame, `fl_layer_apply`, north_west, x0 y0) → `q_auto:best`.

**Why:** guarantees cloud output is pixel-identical to the on-device preview
(same fonts, emoji, wrapping, positioning) and sidesteps all Cloudinary
text-encoding/font limits in one move.

**How to apply:** if you ever reintroduce server-side `l_text`, expect emoji/
curly-quote captions to 400 at delivery. Keep the overlay-PNG approach for any
user-supplied text. The JSON body limit is 10mb to fit the base64 PNG; a mostly
transparent 1080x1920 PNG is small, but keep the limit in mind.
