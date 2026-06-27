import { Router, type IRouter } from "express";
import { Readable } from "node:stream";

const router: IRouter = Router();

const ALLOWED_HOSTS = new Set([
  "video.twimg.com",
  "video-ft.twimg.com",
  "pbs.twimg.com",
]);

router.get("/proxy-media", async (req, res) => {
  const rawUrl = req.query["url"];

  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    res.status(400).json({ error: "A 'url' query parameter is required." });
    return;
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid media URL." });
    return;
  }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    res.status(400).json({ error: "Media host is not allowed." });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    // Do NOT follow redirects automatically: an allowed host could redirect to
    // an internal/arbitrary host and bypass the allowlist (SSRF). Reject any
    // redirect explicitly.
    const upstream = await fetch(target.toString(), {
      headers: { Accept: "*/*" },
      signal: controller.signal,
      redirect: "manual",
    });

    // Browser fetch surfaces a blocked redirect as type "opaqueredirect"
    // (status 0); Node's undici returns the raw 3xx with its real status code.
    // Reject both.
    const isRedirect =
      upstream.type === "opaqueredirect" ||
      upstream.status === 0 ||
      (upstream.status >= 300 && upstream.status < 400);
    if (isRedirect) {
      req.log.warn(
        { url: target.toString(), status: upstream.status },
        "Media proxy upstream attempted a redirect; rejecting",
      );
      res.status(502).json({ error: "Could not fetch the media file." });
      return;
    }

    if (!upstream.ok || !upstream.body) {
      req.log.warn(
        { status: upstream.status, url: target.toString() },
        "Media proxy upstream returned non-OK",
      );
      res.status(502).json({ error: "Could not fetch the media file." });
      return;
    }

    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", "public, max-age=3600");

    const nodeStream = Readable.fromWeb(upstream.body as never);
    nodeStream.on("error", (err) => {
      req.log.error({ err }, "Media proxy stream error");
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    nodeStream.pipe(res);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    req.log.error({ err, aborted }, "Media proxy failed");
    if (!res.headersSent) {
      res.status(502).json({
        error: aborted
          ? "The media file took too long to fetch."
          : "Could not fetch the media file.",
      });
    }
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
