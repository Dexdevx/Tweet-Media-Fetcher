import { useCallback, useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import {
  DEFAULT_OVERLAY,
  transformCase,
  type Align,
  type CaseMode,
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

function proxyUrl(rawUrl: string): string {
  return `/api/proxy-media?url=${encodeURIComponent(rawUrl)}`;
}

const CASE_OPTIONS: { value: CaseMode; label: string }[] = [
  { value: "original", label: "Orig" },
  { value: "upper", label: "AA" },
  { value: "title", label: "Aa" },
  { value: "lower", label: "aa" },
];

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
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(0);

  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);

  const frameRef = useRef<HTMLDivElement>(null);
  const videoBlobRef = useRef<Blob | null>(null);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    start: OverlayState;
  } | null>(null);

  useEffect(() => {
    setOverlay((prev) => ({ ...prev, text: title }));
  }, [title]);

  // Track frame height so the caption font size scales with the preview.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setFrameHeight(frame.getBoundingClientRect().height);
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

    setOverlay((prev) => {
      if (drag.mode === "move") {
        const x = Math.min(Math.max(0, drag.start.xFrac + dx), 1 - prev.wFrac);
        const y = Math.min(Math.max(0, drag.start.yFrac + dy), 0.98);
        return { ...prev, xFrac: x, yFrac: y };
      }
      const w = Math.min(Math.max(0.2, drag.start.wFrac + dx), 1 - prev.xFrac);
      const font = Math.min(
        Math.max(0.02, drag.start.fontFrac + dy * 0.4),
        0.16,
      );
      return { ...prev, wFrac: w, fontFrac: font };
    });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  const startDrag = useCallback(
    (mode: "move" | "resize", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        start: overlay,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [overlay, onPointerMove, endDrag],
  );

  useEffect(() => endDrag, [endDrag]);

  const handleRender = async () => {
    if (!videoBlobRef.current) return;
    setRendering(true);
    setRenderError(null);
    setRenderProgress(0);
    setRenderStage("Starting");
    try {
      const blob = await renderVideoWithOverlay({
        videoBlob: videoBlobRef.current,
        overlay,
        onProgress: (r) => setRenderProgress(r),
        onStage: (s) => setRenderStage(s),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "x-media-caption.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
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

  const displayedText = transformCase(overlay.text, overlay.caseMode);
  const captionFontPx = Math.max(8, overlay.fontFrac * frameHeight);

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

          {/* Caption overlay */}
          {videoSrc && displayedText.trim() && (
            <div
              role="button"
              tabIndex={0}
              onPointerDown={(e) => startDrag("move", e)}
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
                onPointerDown={(e) => startDrag("resize", e)}
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
            onClick={() =>
              setOverlay((prev) => ({ ...DEFAULT_OVERLAY, text: prev.text }))
            }
            className="rounded-xl"
            data-testid="button-reset"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
        </div>

        {rendering && (
          <div className="space-y-2" data-testid="render-progress">
            <Progress value={Math.round(renderProgress * 100)} />
            <p className="text-xs text-muted-foreground">
              {renderStage}
              {renderProgress > 0
                ? ` — ${Math.round(renderProgress * 100)}%`
                : ""}
              . Rendering happens in your browser and may take a little while.
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
          Output is a 9:16 vertical MP4 with your caption burned in.
        </p>
      </div>
    </div>
  );
}
