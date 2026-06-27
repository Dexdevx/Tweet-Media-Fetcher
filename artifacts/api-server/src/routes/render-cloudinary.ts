import { Router, type IRouter } from "express";
import { RenderCloudinaryBody } from "@workspace/api-zod";
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

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
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
        const res = (await cloudinary.api.resources({
          type: "upload",
          prefix: `${UPLOAD_FOLDER}/`,
          resource_type: resourceType,
          max_results: 100,
        })) as { resources?: { public_id: string; created_at: string }[] };
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

  const { videoUrl, overlay, logo } = parsed.data;

  const validatedVideo = validateMediaUrl(videoUrl);
  if (!validatedVideo.ok || !validatedVideo.url) {
    res
      .status(400)
      .json({ error: validatedVideo.error ?? "Invalid video URL." });
    return;
  }

  let videoPublicId: string | null = null;
  let logoPublicId: string | null = null;

  try {
    // Upload the logo first (if any) so the transformation can reference it.
    if (logo?.dataUrl) {
      const logoUpload = await cloudinary.uploader.upload(logo.dataUrl, {
        resource_type: "image",
        folder: UPLOAD_FOLDER,
        timeout: 60000,
      });
      logoPublicId = logoUpload.public_id;
    }

    const videoUpload = await cloudinary.uploader.upload(
      validatedVideo.url.toString(),
      {
        resource_type: "video",
        folder: UPLOAD_FOLDER,
        timeout: 120000,
      },
    );
    videoPublicId = videoUpload.public_id;

    // Build the 9:16 transformation: pad to a black vertical frame, then burn
    // in the caption (top, via north_west + fractional offsets) and the logo.
    const transformation: Record<string, unknown>[] = [
      {
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
        crop: "pad",
        background: "black",
      },
    ];

    const caption = overlay.text.replace(/\s*\n\s*/g, " ").trim();
    if (caption) {
      transformation.push({
        overlay: {
          font_family: "Arial",
          font_size: Math.round(
            clamp(overlay.fontFrac, 0.01, 0.3) * OUTPUT_HEIGHT,
          ),
          font_weight: "bold",
          text_align: overlay.align,
          text: caption,
        },
        color: "white",
        width: Math.round(clamp(overlay.wFrac, 0.05, 1) * OUTPUT_WIDTH),
        crop: "fit",
        gravity: "north_west",
        x: Math.round(clamp(overlay.xFrac, 0, 1) * OUTPUT_WIDTH),
        y: Math.round(clamp(overlay.yFrac, 0, 1) * OUTPUT_HEIGHT),
        effect: "outline:2:black",
      });
    }

    if (logoPublicId) {
      transformation.push({
        overlay: { public_id: logoPublicId },
        width: Math.round(clamp(logo?.wFrac ?? 0.3, 0.05, 1) * OUTPUT_WIDTH),
        crop: "fit",
        gravity: "north_west",
        x: Math.round(clamp(logo?.xFrac ?? 0.35, 0, 1) * OUTPUT_WIDTH),
        y: Math.round(clamp(logo?.yFrac ?? 0.85, 0, 1) * OUTPUT_HEIGHT),
      });
    }

    transformation.push({ quality: "auto:best" });

    const downloadUrl = cloudinary.url(videoPublicId, {
      resource_type: "video",
      transformation,
      format: "mp4",
      flags: "attachment:x-media-caption",
      secure: true,
    });

    // Free up Cloudinary storage/credits shortly after delivery. A server
    // restart drops the timer, which is acceptable for these temporary assets.
    const idsToDelete = { video: videoPublicId, logo: logoPublicId };
    setTimeout(() => {
      void cloudinary.uploader
        .destroy(idsToDelete.video, {
          resource_type: "video",
          invalidate: true,
        })
        .catch((err: unknown) =>
          logger.warn({ err }, "Failed to delete Cloudinary video"),
        );
      if (idsToDelete.logo) {
        void cloudinary.uploader
          .destroy(idsToDelete.logo, {
            resource_type: "image",
            invalidate: true,
          })
          .catch((err: unknown) =>
            logger.warn({ err }, "Failed to delete Cloudinary logo"),
          );
      }
    }, DELETE_AFTER_MS);

    res.json({ downloadUrl, expiresInSeconds: DELETE_AFTER_MS / 1000 });
  } catch (err) {
    req.log.error({ err }, "Cloudinary render failed");
    // Best-effort cleanup if we failed partway through.
    if (videoPublicId) {
      void cloudinary.uploader
        .destroy(videoPublicId, { resource_type: "video" })
        .catch(() => {});
    }
    if (logoPublicId) {
      void cloudinary.uploader
        .destroy(logoPublicId, { resource_type: "image" })
        .catch(() => {});
    }
    res.status(502).json({
      error:
        "Cloud rendering failed. Please try again or use device rendering instead.",
    });
  }
});

export default router;
