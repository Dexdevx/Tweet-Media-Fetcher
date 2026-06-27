import { Router, type IRouter } from "express";
import { v2 as cloudinary } from "cloudinary";
import { RenderCloudinaryBody } from "@workspace/api-zod";
import { validateMediaUrl } from "../lib/twimg";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Max-quality vertical output for the cloud path (the device path uses a
// smaller frame for wasm performance; Cloudinary can afford full size).
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const DELETE_AFTER_MS = 5 * 60 * 1000;
const UPLOAD_FOLDER = "xmd_tmp";

// Cloudinary's SDK reads CLOUDINARY_URL from the environment automatically.
cloudinary.config({ secure: true });

function isConfigured(): boolean {
  return Boolean(cloudinary.config().cloud_name);
}

router.post("/render-cloudinary", async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({
      error:
        "Cloud rendering isn't configured. Add the CLOUDINARY_URL secret to enable it.",
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
          font_size: Math.max(12, Math.round(overlay.fontFrac * OUTPUT_HEIGHT)),
          font_weight: "bold",
          text_align: overlay.align,
          text: caption,
        },
        color: "white",
        width: Math.round(overlay.wFrac * OUTPUT_WIDTH),
        crop: "fit",
        gravity: "north_west",
        x: Math.round(overlay.xFrac * OUTPUT_WIDTH),
        y: Math.round(overlay.yFrac * OUTPUT_HEIGHT),
        effect: "outline:2:black",
      });
    }

    if (logoPublicId) {
      transformation.push({
        overlay: { public_id: logoPublicId },
        width: Math.round((logo?.wFrac ?? 0.3) * OUTPUT_WIDTH),
        crop: "fit",
        gravity: "north_west",
        x: Math.round((logo?.xFrac ?? 0.35) * OUTPUT_WIDTH),
        y: Math.round((logo?.yFrac ?? 0.85) * OUTPUT_HEIGHT),
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
