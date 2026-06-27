import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import {
  RenderCloudinaryBody,
  CleanupCloudinaryBody,
} from "@workspace/api-zod";
import { validateMediaUrl } from "../lib/twimg";
import { logger } from "../lib/logger";

type CloudinaryApi = (typeof import("cloudinary"))["v2"];

const router: IRouter = Router();

// Max-quality vertical output for the cloud path (the device path uses a
// smaller frame for wasm performance; Cloudinary can afford full size).
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const DELETE_AFTER_MS = 5 * 60 * 1000;
const UPLOAD_FOLDER = "xmd_tmp";

// The Cloudinary SDK parses CLOUDINARY_URL when its module is first imported and
// throws if the value is malformed — which would crash the whole server. So we
// (a) sanitize the value and (b) import the SDK lazily inside a try/catch, so a
// bad secret only disables this one feature instead of taking the API down.
function normalizedCloudinaryUrl(): string | null {
  let raw = process.env["CLOUDINARY_URL"];
  if (!raw) return null;
  raw = raw.trim().replace(/^["']|["']$/g, "");
  // Tolerate users pasting the whole `CLOUDINARY_URL=cloudinary://...` line.
  raw = raw.replace(/^CLOUDINARY_URL\s*=\s*/, "").trim();
  // Tolerate placeholder angle brackets left in from the docs example
  // (`cloudinary://<key>:<secret>@<cloud>`); a real URL never contains < or >.
  raw = raw.replace(/[<>]/g, "");
  return raw.startsWith("cloudinary://") ? raw : null;
}

// Signed proof that a cleanup request owns the assets it names. We bind both
// public IDs into an HMAC so possessing the IDs alone is not enough to delete
// someone else's temporary render. SESSION_SECRET is the signing key; if it is
// absent we fall back to a per-process random key — fine here because assets
// (and thus tokens) only live ~5 minutes anyway.
const CLEANUP_SECRET =
  process.env["SESSION_SECRET"]?.trim() || randomBytes(32).toString("hex");
function cleanupToken(videoPublicId: string, overlayPublicId: string): string {
  return createHmac("sha256", CLEANUP_SECRET)
    .update(`${videoPublicId}\n${overlayPublicId}`)
    .digest("hex");
}
function verifyCleanupToken(
  videoPublicId: string,
  overlayPublicId: string,
  token: string,
): boolean {
  const expected = cleanupToken(videoPublicId, overlayPublicId);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Validate and decode the browser-rendered overlay: must be a base64 PNG data
// URL, with a real PNG signature and within a sane size bound. Returns the
// decoded bytes (so a malformed payload is rejected here, not at Cloudinary).
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_OVERLAY_BYTES = 8 * 1024 * 1024;
function decodePngDataUrl(value: string): Buffer | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[1] ?? "", "base64");
  } catch {
    return null;
  }
  if (bytes.length < 8 || bytes.length > MAX_OVERLAY_BYTES) return null;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return bytes;
}

// Safety net for the per-request deletion timer: if the server restarts before a
// timer fires, those temporary assets would otherwise linger and burn credits.
// This periodic sweep removes anything left in the temp folder past its TTL.
let sweepStarted = false;
function startCleanupSweep(cloudinary: CloudinaryApi): void {
  if (sweepStarted) return;
  sweepStarted = true;

  const sweep = async () => {
    const cutoff = Date.now() - DELETE_AFTER_MS;
    for (const resourceType of ["video", "image"] as const) {
      try {
        // Page through all matching assets so a backlog larger than one page
        // still gets fully swept.
        let nextCursor: string | undefined;
        do {
          const res = (await cloudinary.api.resources({
            type: "upload",
            prefix: `${UPLOAD_FOLDER}/`,
            resource_type: resourceType,
            max_results: 100,
            next_cursor: nextCursor,
          })) as {
            resources?: { public_id: string; created_at: string }[];
            next_cursor?: string;
          };
          for (const r of res.resources ?? []) {
            if (new Date(r.created_at).getTime() >= cutoff) continue;
            await cloudinary.uploader
              .destroy(r.public_id, {
                resource_type: resourceType,
                invalidate: true,
              })
              .catch((err: unknown) =>
                logger.warn(
                  { err, publicId: r.public_id },
                  "Cleanup sweep failed to delete asset",
                ),
              );
          }
          nextCursor = res.next_cursor;
        } while (nextCursor);
      } catch (err) {
        logger.warn({ err, resourceType }, "Cloudinary cleanup sweep failed");
      }
    }
  };

  const timer = setInterval(() => void sweep(), DELETE_AFTER_MS);
  timer.unref?.();
  void sweep();
}

let cloudinaryPromise: Promise<CloudinaryApi | null> | null = null;

function getCloudinary(): Promise<CloudinaryApi | null> {
  if (cloudinaryPromise) return cloudinaryPromise;
  cloudinaryPromise = (async () => {
    const url = normalizedCloudinaryUrl();
    if (!url) return null;
    // Feed the SDK the sanitized value so its import-time parse succeeds.
    process.env["CLOUDINARY_URL"] = url;
    try {
      const mod = await import("cloudinary");
      mod.v2.config({ secure: true });
      startCleanupSweep(mod.v2);
      return mod.v2;
    } catch (err) {
      logger.error({ err }, "Failed to initialize Cloudinary");
      return null;
    }
  })();
  return cloudinaryPromise;
}

router.post("/render-cloudinary", async (req, res) => {
  const cloudinary = await getCloudinary();
  if (!cloudinary) {
    res.status(503).json({
      error:
        "Cloud rendering isn't configured. Add a valid CLOUDINARY_URL secret to enable it.",
    });
    return;
  }

  const parsed = RenderCloudinaryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid render request." });
    return;
  }

  const { videoUrl, overlayDataUrl } = parsed.data;

  const validatedVideo = validateMediaUrl(videoUrl);
  if (!validatedVideo.ok || !validatedVideo.url) {
    res
      .status(400)
      .json({ error: validatedVideo.error ?? "Invalid video URL." });
    return;
  }

  if (!decodePngDataUrl(overlayDataUrl)) {
    res.status(400).json({ error: "Invalid overlay image." });
    return;
  }

  let videoPublicId: string | null = null;
  let overlayPublicId: string | null = null;

  try {
    // Upload the browser-rendered overlay PNG first so the transformation can
    // reference it. It already contains the caption + logo composited at the
    // exact 9:16 frame size, so Cloudinary just lays it over the padded video —
    // this guarantees parity with the on-device preview and sidesteps
    // Cloudinary text-layer encoding/font limits (e.g. emoji, curly quotes).
    const overlayUpload = await cloudinary.uploader.upload(overlayDataUrl, {
      resource_type: "image",
      folder: UPLOAD_FOLDER,
      timeout: 60000,
    });
    overlayPublicId = overlayUpload.public_id;

    const videoUpload = await cloudinary.uploader.upload(
      validatedVideo.url.toString(),
      {
        resource_type: "video",
        folder: UPLOAD_FOLDER,
        timeout: 120000,
      },
    );
    videoPublicId = videoUpload.public_id;

    // Pad the video to a black vertical frame, then overlay the full-frame PNG.
    const transformation: Record<string, unknown>[] = [
      {
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        crop: "pad",
        background: "black",
      },
      {
        overlay: { public_id: overlayPublicId },
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        crop: "fit",
        flags: "layer_apply",
        gravity: "north_west",
        x: 0,
        y: 0,
      },
      { quality: "auto:best" },
    ];

    const downloadUrl = cloudinary.url(videoPublicId, {
      resource_type: "video",
      transformation,
      format: "mp4",
      flags: "attachment:x-media-caption",
      secure: true,
    });

    // Free up Cloudinary storage/credits shortly after delivery. A server
    // restart drops the timer, which is acceptable for these temporary assets.
    const idsToDelete = { video: videoPublicId, overlay: overlayPublicId };
    setTimeout(() => {
      void cloudinary.uploader
        .destroy(idsToDelete.video, {
          resource_type: "video",
          invalidate: true,
        })
        .catch((err: unknown) =>
          logger.warn({ err }, "Failed to delete Cloudinary video"),
        );
      void cloudinary.uploader
        .destroy(idsToDelete.overlay, {
          resource_type: "image",
          invalidate: true,
        })
        .catch((err: unknown) =>
          logger.warn({ err }, "Failed to delete Cloudinary overlay"),
        );
    }, DELETE_AFTER_MS);

    res.json({
      downloadUrl,
      expiresInSeconds: DELETE_AFTER_MS / 1000,
      videoPublicId,
      overlayPublicId,
      cleanupToken: cleanupToken(videoPublicId, overlayPublicId),
    });
  } catch (err) {
    req.log.error({ err }, "Cloudinary render failed");
    // Best-effort cleanup if we failed partway through.
    if (videoPublicId) {
      void cloudinary.uploader
        .destroy(videoPublicId, { resource_type: "video" })
        .catch(() => {});
    }
    if (overlayPublicId) {
      void cloudinary.uploader
        .destroy(overlayPublicId, { resource_type: "image" })
        .catch(() => {});
    }
    res.status(502).json({
      error:
        "Cloud rendering failed. Please try again or use device rendering instead.",
    });
  }
});

// Only allow deleting the temporary assets we created, never arbitrary ones.
function isTempPublicId(id: string): boolean {
  return id.startsWith(`${UPLOAD_FOLDER}/`);
}

router.post("/cleanup-cloudinary", async (req, res) => {
  const cloudinary = await getCloudinary();
  if (!cloudinary) {
    res.status(503).json({ error: "Cloud rendering isn't configured." });
    return;
  }

  const parsed = CleanupCloudinaryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid cleanup request." });
    return;
  }

  const { videoPublicId, overlayPublicId, cleanupToken: token } = parsed.data;
  if (!isTempPublicId(videoPublicId) || !isTempPublicId(overlayPublicId)) {
    res.status(400).json({ error: "Unknown asset." });
    return;
  }
  // The signed token proves the caller owns these specific assets, so the IDs
  // alone can't be used to delete another user's render.
  if (!verifyCleanupToken(videoPublicId, overlayPublicId, token)) {
    res.status(403).json({ error: "Invalid cleanup token." });
    return;
  }

  // Cloudinary's destroy() resolves with { result: "ok" | "not found" | ... }
  // rather than throwing on a miss, so inspect the result to report truthfully.
  const destroyed = async (
    publicId: string,
    resourceType: "video" | "image",
  ): Promise<boolean> => {
    try {
      const r = (await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      })) as { result?: string };
      // "not found" means it's already gone (auto-deleted) — treat as success.
      return r.result === "ok" || r.result === "not found";
    } catch (err) {
      req.log.warn({ err, publicId }, "On-demand cleanup failed");
      return false;
    }
  };

  const [videoOk, overlayOk] = await Promise.all([
    destroyed(videoPublicId, "video"),
    destroyed(overlayPublicId, "image"),
  ]);

  const deleted = videoOk && overlayOk;
  res.status(deleted ? 200 : 502).json({ deleted });
});

export default router;
