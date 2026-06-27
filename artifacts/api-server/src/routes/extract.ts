import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { ExtractMediaResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const UPSTREAM_BASE = "https://tweeterdownloader.com/wp-json/xvd/v1/extract";
const UPSTREAM_TIMEOUT_MS = 20000;

const tweetUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    const allowedHosts = [
      "x.com",
      "www.x.com",
      "twitter.com",
      "www.twitter.com",
      "mobile.twitter.com",
    ];
    if (!allowedHosts.includes(host)) {
      return false;
    }
    return /\/status\/\d+/.test(parsed.pathname);
  }, "Must be a valid X/Twitter post URL (e.g. https://x.com/user/status/123).");

const upstreamSchema = z.object({
  title: z.string().optional(),
  source: z.string().nullish(),
  duration: z.number().nullish(),
  thumbnail: z.string().nullish(),
  media: z
    .array(
      z.object({
        url: z.string(),
        quality: z.string().nullish(),
        type: z.string().nullish(),
      }),
    )
    .optional(),
  images: z.array(z.string()).optional(),
});

router.get("/extract", async (req, res) => {
  const parsedUrl = tweetUrlSchema.safeParse(req.query["url"]);

  if (!parsedUrl.success) {
    res.status(400).json({
      error:
        "A valid X/Twitter post URL is required (e.g. https://x.com/user/status/123).",
    });
    return;
  }

  const url = parsedUrl.data;
  const upstreamUrl = `${UPSTREAM_BASE}?url=${encodeURIComponent(url)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!upstream.ok) {
      req.log.warn(
        { status: upstream.status, url },
        "Upstream extraction returned non-OK status",
      );
      res.status(502).json({
        error:
          "Could not extract media from that post. Check the URL and try again.",
      });
      return;
    }

    const raw = await upstream.json();
    const upstreamParsed = upstreamSchema.safeParse(raw);

    if (!upstreamParsed.success) {
      req.log.warn(
        { url, issues: upstreamParsed.error.issues },
        "Upstream returned an unexpected payload shape",
      );
      res.status(502).json({
        error:
          "Could not extract media from that post. Check the URL and try again.",
      });
      return;
    }

    const data = upstreamParsed.data;
    const media = (data.media ?? []).map((item) => ({
      url: item.url,
      quality: item.quality ?? null,
      type: item.type ?? "mp4",
    }));

    if (media.length === 0 && (data.images ?? []).length === 0) {
      res.status(502).json({
        error: "No downloadable media was found in that post.",
      });
      return;
    }

    const result = ExtractMediaResponse.parse({
      title: data.title ?? "",
      source: data.source ?? null,
      duration: data.duration ?? null,
      thumbnail: data.thumbnail ?? null,
      media,
      images: data.images ?? [],
    });

    res.json(result);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    req.log.error({ err, url, aborted }, "Failed to extract media");
    res.status(502).json({
      error: aborted
        ? "The extraction service took too long to respond. Please try again."
        : "Could not extract media from that post. Check the URL and try again.",
    });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
