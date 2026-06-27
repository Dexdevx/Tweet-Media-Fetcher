// Shared SSRF guard for Twitter/X media hosts. Both the media proxy and the
// Cloudinary render route fetch user-supplied media URLs, so the host allowlist
// lives in one place to avoid drift.
export const ALLOWED_MEDIA_HOSTS = new Set([
  "video.twimg.com",
  "video-ft.twimg.com",
  "pbs.twimg.com",
]);

export interface ValidatedMediaUrl {
  ok: boolean;
  url?: URL;
  error?: string;
}

export function validateMediaUrl(raw: unknown): ValidatedMediaUrl {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "A media URL is required." };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid media URL." };
  }

  if (url.protocol !== "https:" || !ALLOWED_MEDIA_HOSTS.has(url.hostname)) {
    return { ok: false, error: "Media host is not allowed." };
  }

  return { ok: true, url };
}
