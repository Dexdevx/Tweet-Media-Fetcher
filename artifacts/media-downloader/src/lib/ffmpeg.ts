import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
  generateOverlayPng,
  type LogoState,
  type OverlayState,
} from "./textOverlay";

export const OUTPUT_WIDTH = 720;
export const OUTPUT_HEIGHT = 1280;

// @ffmpeg/ffmpeg@0.12.x creates a MODULE worker. A module worker can't use
// importScripts, so it loads the core via `await import(coreURL)` and reads the
// `default` export. Only the ESM core build provides `export default`; the UMD
// build exposes a global/module.exports and yields `undefined`, which throws
// "failed to import ffmpeg-core.js". So we must use the /esm/ core, not /umd/.
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(
  onLog?: (message: string) => void,
): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on("log", ({ message }) => onLog(message));
    }
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  // Allow a retry if the initial load fails (e.g. transient CDN/network error).
  loadPromise.catch(() => {
    loadPromise = null;
  });

  return loadPromise;
}

export interface RenderArgs {
  videoBlob: Blob;
  overlay: OverlayState;
  logo?: LogoState | null;
  onProgress?: (ratio: number) => void;
  onStage?: (stage: string) => void;
}

export async function renderVideoWithOverlay({
  videoBlob,
  overlay,
  logo,
  onProgress,
  onStage,
}: RenderArgs): Promise<Blob> {
  onStage?.("Loading renderer");
  const ffmpeg = await getFFmpeg();

  const progressHandler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) {
      onProgress?.(Math.min(1, Math.max(0, progress)));
    }
  };
  ffmpeg.on("progress", progressHandler);

  try {
    onStage?.("Preparing files");
    const overlayPng = await generateOverlayPng(
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT,
      overlay,
      logo,
    );

    await ffmpeg.writeFile("input.mp4", await fetchFile(videoBlob));
    await ffmpeg.writeFile("overlay.png", overlayPng);

    const filter =
      `[0:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
      `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[bg];` +
      `[bg][1:v]overlay=0:0[v]`;

    onStage?.("Rendering video");
    await ffmpeg.exec([
      "-i",
      "input.mp4",
      "-i",
      "overlay.png",
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "26",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-shortest",
      "output.mp4",
    ]);

    onStage?.("Finalizing");
    const data = await ffmpeg.readFile("output.mp4");
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);

    return new Blob([copy], { type: "video/mp4" });
  } finally {
    ffmpeg.off("progress", progressHandler);
    // Always clean up the wasm FS so failed renders don't leak memory.
    await ffmpeg.deleteFile("input.mp4").catch(() => {});
    await ffmpeg.deleteFile("overlay.png").catch(() => {});
    await ffmpeg.deleteFile("output.mp4").catch(() => {});
  }
}

export function preloadFFmpeg(): void {
  void getFFmpeg();
}
