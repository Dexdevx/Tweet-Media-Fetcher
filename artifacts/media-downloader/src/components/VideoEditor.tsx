import { useCallback, useEffect, useRef, useState } from "react";
import { useRenderCloudinary } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Download,
  Loader2,
  Sparkles,
  RotateCcw,
  ImagePlus,
  X,
  Smartphone,
  Cloud,
} from "lucide-react";
import {
  DEFAULT_OVERLAY,
  DEFAULT_LOGO,
  transformCase,
  generateOverlayDataUrl,
  type Align,
  type CaseMode,
  type LogoState,
  type OverlayState,
} from "@/lib/textOverlay";
import { renderVideoWithOverlay, preloadFFmpeg } from "@/lib/ffmpeg";

interface VideoOption {
  url: string;
  quality?: string | null;
  type: string;
}

interface VideoEditorProps {
  title: string;
  selectedUrl: string;
  mediaOptions: VideoOption[];
  onSelectQuality: (url: string) => void;
}

type RenderMode = "device" | "cloud";
type DragTarget = "caption" | "logo";

// Cloud render output frame (9:16, max quality). The browser renders the
// overlay PNG at this exact size so Cloudinary can lay it over the padded video.
const CLOUD_OUTPUT_WIDTH = 1080;
const CLOUD_OUTPUT_HEIGHT = 1920;

function proxyUrl(rawUrl: string): string {
  return `/api/proxy-media?url=${encodeURIComponent(rawUrl)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the logo file."));
    reader.readAsDataURL(file);
  });
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const CASE_OPTIONS: { value: CaseMode; label: string }[] = [
  { value: "original", label: "Orig" },
  { value: "upper", label: "AA" },
  { value: "title", label: "Aa" },
  { value: "lower", label: "aa" },
];

interface DragState {
  target: DragTarget;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  startOverlay: OverlayState;
  startLogo: LogoState | null;
}

export function VideoEditor({
  title,
  selectedUrl,
  mediaOptions,
  onSelectQuality,
}: VideoEditorProps) {
  const [overlay, setOverlay] = useState<OverlayState>({
    text: title,
    ...DEFAULT_OVERLAY,
  });
  const [logo, setLogo] = useState<LogoState | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("device");

  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoBlobRef = useRef<Blob | null>(null);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const cloudRender = useRenderCloudinary();

  useEffect(() => {
    setOverlay((prev) => ({ ...prev, text: title }));
  }, [title]);

  // Track frame size so caption font + logo scale with the preview.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => {
      const rect = frame.getBoundingClientRect();
      setFrameSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  // Fetch the selected video through the proxy and turn it into a blob URL.
  useEffect(() => {
    if (!selectedUrl) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    setVideoLoading(true);
    setVideoError(null);
    setVideoSrc(null);
    videoBlobRef.current = null;

    (async () => {
      try {
        const res = await fetch(proxyUrl(selectedUrl));
        if (!res.ok) throw new Error(`Failed to load video (${res.status})`);
        const blob = await res.blob();
        if (cancelled) return;
        videoBlobRef.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setVideoSrc(objectUrl);
        preloadFFmpeg();
      } catch (err) {
        if (cancelled) return;
        videoBlobRef.current = null;
        setVideoSrc(null);
        setVideoError(
          err instanceof Error ? err.message : "Could not load the video.",
        );
      } finally {
        if (!cancelled) setVideoLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedUrl]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;
    const rect = frame.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;

    if (drag.target === "caption") {
      setOverlay((prev) => {
        if (drag.mode === "move") {
          const x = Math.min(
            Math.max(0, drag.startOverlay.xFrac + dx),
            1 - prev.wFrac,
          );
          const y = Math.min(Math.max(0, drag.startOverlay.yFrac + dy), 0.98);
          return { ...prev, xFrac: x, yFrac: y };
        }
        const w = Math.min(
          Math.max(0.2, drag.startOverlay.wFrac + dx),
          1 - prev.xFrac,
        );
        const font = Math.min(
          Math.max(0.02, drag.startOverlay.fontFrac + dy * 0.4),
          0.16,
        );
        return { ...prev, wFrac: w, fontFrac: font };
      });
      return;
    }

    setLogo((prev) => {
      if (!prev || !drag.startLogo) return prev;
      if (drag.mode === "move") {
        const x = Math.min(
          Math.max(0, drag.startLogo.xFrac + dx),
          1 - prev.wFrac,
        );
        const y = Math.min(Math.max(0, drag.startLogo.yFrac + dy), 0.98);
        return { ...prev, xFrac: x, yFrac: y };
      }
      const w = Math.min(
        Math.max(0.08, drag.startLogo.wFrac + dx),
        1 - prev.xFrac,
      );
      return { ...prev, wFrac: w };
    });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  const startDrag = useCallback(
    (target: DragTarget, mode: "move" | "resize", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        target,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startOverlay: overlay,
        startLogo: logo,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [overlay, logo, onPointerMove, endDrag],
  );

  useEffect(() => endDrag, [endDrag]);

  const handleLogoFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setLogo({ dataUrl, ...DEFAULT_LOGO });
      setRenderError(null);
    } catch (err) {
      setRenderError(
        err instanceof Error ? err.message : "Could not read the logo file.",
      );
    }
  };

  const removeLogo = () => {
    setLogo(null);
    logoImgRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const captionPayload = (): OverlayState => ({
    ...overlay,
    text: transformCase(overlay.text, overlay.caseMode),
  });

  const handleDeviceRender = async () => {
    if (!videoBlobRef.current) return;
    setRendering(true);
    setRenderError(null);
    setRenderProgress(0);
    setRenderStage("Starting");
    try {
      const blob = await renderVideoWithOverlay({
        videoBlob: videoBlobRef.current,
        overlay: captionPayload(),
        logo,
        onProgress: (r) => setRenderProgress(r),
        onStage: (s) => setRenderStage(s),
      });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, "x-media-caption.mp4");
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setRenderStage("Done");
    } catch (err) {
      setRenderError(
        err instanceof Error
          ? err.message
          : "Rendering failed. Try a lower quality.",
      );
    } finally {
      setRendering(false);
    }
  };

  const handleCloudRender = async () => {
    setRendering(true);
    setRenderError(null);
    setRenderProgress(0);
    setRenderStage("Uploading to cloud");
    try {
      // Render the overlay (caption + logo) in the browser at the cloud output
      // size and send it as a single PNG. Cloudinary lays it over the video, so
      // the result matches the preview exactly and avoids text-layer encoding
      // limits (emoji, curly quotes, etc.).
      const overlayDataUrl = await generateOverlayDataUrl(
        CLOUD_OUTPUT_WIDTH,
        CLOUD_OUTPUT_HEIGHT,
        captionPayload(),
        logo,
      );
      const result = await cloudRender.mutateAsync({
        data: {
          videoUrl: selectedUrl,
          overlayDataUrl,
        },
      });
      setRenderStage("Done");
      triggerDownload(result.downloadUrl, "x-media-caption.mp4");
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 503) {
        setRenderError(
          "Cloud rendering isn't set up yet. Switch to device rendering or add the Cloudinary key.",
        );
      } else {
        setRenderError(
          err instanceof Error
            ? err.message
            : "Cloud rendering failed. Try device rendering instead.",
        );
      }
    } finally {
      setRendering(false);
    }
  };

  const handleRender = () => {
    if (renderMode === "cloud") return handleCloudRender();
    return handleDeviceRender();
  };

  const displayedText = transformCase(overlay.text, overlay.caseMode);
  const captionFontPx = Math.max(8, overlay.fontFrac * frameSize.height);

  return (
    <div className="grid items-start gap-6 md:grid-cols-[auto_1fr]">
      {/* 9:16 Preview Frame */}
      <div className="mx-auto w-full max-w-[300px]">
        <div
          ref={frameRef}
          className="relative aspect-[9/16] w-full select-none overflow-hidden rounded-2xl bg-black shadow-lg"
          data-testid="editor-frame"
        >
          {videoSrc && (
            <video
              src={videoSrc}
              className="absolute inset-0 h-full w-full object-contain"
              controls
              playsInline
              loop
              data-testid="editor-video"
            />
          )}

          {(videoLoading || (!videoSrc && !videoError)) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-sm">Loading video…</span>
            </div>
          )}

          {videoError && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-300">
              {videoError}
            </div>
          )}

          {/* Logo overlay */}
          {videoSrc && logo && (
            <div
              role="button"
              tabIndex={0}
              onPointerDown={(e) => startDrag("logo", "move", e)}
              className="absolute cursor-move touch-none ring-1 ring-white/40"
              style={{
                left: `${logo.xFrac * 100}%`,
                top: `${logo.yFrac * 100}%`,
                width: `${logo.wFrac * 100}%`,
              }}
              data-testid="logo-overlay"
            >
              <img
                ref={logoImgRef}
                src={logo.dataUrl}
                alt="Logo overlay"
                className="pointer-events-none block w-full"
                draggable={false}
              />
              <div
                onPointerDown={(e) => startDrag("logo", "resize", e)}
                className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-primary"
                data-testid="logo-resize"
              />
            </div>
          )}

          {/* Caption overlay */}
          {videoSrc && displayedText.trim() && (
            <div
              role="button"
              tabIndex={0}
              onPointerDown={(e) => startDrag("caption", "move", e)}
              className="absolute cursor-move touch-none"
              style={{
                left: `${overlay.xFrac * 100}%`,
                top: `${overlay.yFrac * 100}%`,
                width: `${overlay.wFrac * 100}%`,
              }}
              data-testid="caption-overlay"
            >
              <p
                className="m-0 whitespace-pre-wrap break-words font-bold leading-tight text-white"
                style={{
                  fontSize: `${captionFontPx}px`,
                  textAlign: overlay.align,
                  textShadow:
                    "0 1px 3px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.7)",
                }}
              >
                {displayedText}
              </p>
              <div
                onPointerDown={(e) => startDrag("caption", "resize", e)}
                className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-primary"
                data-testid="caption-resize"
              />
            </div>
          )}
        </div>

        {/* Quality switch */}
        {mediaOptions.length > 1 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {mediaOptions.map((m, i) => (
              <Button
                key={i}
                size="sm"
                variant={m.url === selectedUrl ? "default" : "outline"}
                className="h-7 rounded-lg px-2 text-xs"
                onClick={() => onSelectQuality(m.url)}
                data-testid={`editor-quality-${i}`}
              >
                {m.quality || m.type}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-muted-foreground">
            Caption text
          </label>
          <Textarea
            value={overlay.text}
            onChange={(e) =>
              setOverlay((prev) => ({ ...prev, text: e.target.value }))
            }
            rows={3}
            className="resize-none rounded-xl"
            data-testid="caption-input"
          />
        </div>

        <div className="flex flex-wrap gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-muted-foreground">
              Text case
            </label>
            <ToggleGroup
              type="single"
              value={overlay.caseMode}
              onValueChange={(v) =>
                v && setOverlay((prev) => ({ ...prev, caseMode: v as CaseMode }))
              }
              className="justify-start"
            >
              {CASE_OPTIONS.map((opt) => (
                <ToggleGroupItem
                  key={opt.value}
                  value={opt.value}
                  className="h-9 min-w-9 rounded-lg border px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  data-testid={`case-${opt.value}`}
                >
                  {opt.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-muted-foreground">
              Align
            </label>
            <ToggleGroup
              type="single"
              value={overlay.align}
              onValueChange={(v) =>
                v && setOverlay((prev) => ({ ...prev, align: v as Align }))
              }
              className="justify-start"
            >
              <ToggleGroupItem
                value="left"
                className="h-9 w-9 rounded-lg border"
                data-testid="align-left"
              >
                <AlignLeft className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="center"
                className="h-9 w-9 rounded-lg border"
                data-testid="align-center"
              >
                <AlignCenter className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="right"
                className="h-9 w-9 rounded-lg border"
                data-testid="align-right"
              >
                <AlignRight className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-muted-foreground">
            Font size
          </label>
          <Slider
            min={2}
            max={16}
            step={0.5}
            value={[overlay.fontFrac * 100]}
            onValueChange={([v]) =>
              setOverlay((prev) => ({ ...prev, fontFrac: (v ?? 4.5) / 100 }))
            }
            data-testid="font-slider"
          />
        </div>

        {/* Logo controls */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-muted-foreground">
            Logo (placed at the bottom)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleLogoFile(e.target.files?.[0])}
            data-testid="logo-input"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-logo-upload"
            >
              <ImagePlus className="mr-2 h-4 w-4" />
              {logo ? "Replace logo" : "Upload logo"}
            </Button>
            {logo && (
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl"
                onClick={removeLogo}
                data-testid="button-logo-remove"
              >
                <X className="mr-2 h-4 w-4" />
                Remove
              </Button>
            )}
          </div>
        </div>

        {/* Render mode */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-muted-foreground">
            Render with
          </label>
          <ToggleGroup
            type="single"
            value={renderMode}
            onValueChange={(v) => v && setRenderMode(v as RenderMode)}
            className="justify-start"
          >
            <ToggleGroupItem
              value="device"
              className="h-9 gap-2 rounded-lg border px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              data-testid="mode-device"
            >
              <Smartphone className="h-4 w-4" />
              Device
            </ToggleGroupItem>
            <ToggleGroupItem
              value="cloud"
              className="h-9 gap-2 rounded-lg border px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              data-testid="mode-cloud"
            >
              <Cloud className="h-4 w-4" />
              Cloud (faster)
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            onClick={handleRender}
            disabled={rendering || !videoSrc || videoLoading}
            className="rounded-xl font-bold"
            data-testid="button-render"
          >
            {rendering ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Rendering…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Render &amp; Download
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setOverlay((prev) => ({ ...DEFAULT_OVERLAY, text: prev.text }));
              removeLogo();
            }}
            className="rounded-xl"
            data-testid="button-reset"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
        </div>

        {rendering && (
          <div className="space-y-2" data-testid="render-progress">
            <Progress
              value={
                renderMode === "cloud"
                  ? undefined
                  : Math.round(renderProgress * 100)
              }
            />
            <p className="text-xs text-muted-foreground">
              {renderStage}
              {renderMode === "device" && renderProgress > 0
                ? ` — ${Math.round(renderProgress * 100)}%`
                : ""}
              .{" "}
              {renderMode === "cloud"
                ? "Rendering on the cloud — this is usually quick."
                : "Rendering happens in your browser and may take a little while."}
            </p>
          </div>
        )}

        {renderError && (
          <p className="text-sm text-red-500" data-testid="render-error">
            {renderError}
          </p>
        )}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Download className="h-3.5 w-3.5" />
          Output is a 9:16 vertical MP4 with your caption{logo ? " and logo" : ""}{" "}
          burned in.
        </p>
      </div>
    </div>
  );
}
