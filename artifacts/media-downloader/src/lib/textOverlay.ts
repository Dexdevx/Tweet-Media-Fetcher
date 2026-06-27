export type CaseMode = "original" | "upper" | "title" | "lower";
export type Align = "left" | "center" | "right";

export interface OverlayState {
  text: string;
  xFrac: number;
  yFrac: number;
  wFrac: number;
  fontFrac: number;
  align: Align;
  caseMode: CaseMode;
}

export const DEFAULT_OVERLAY: Omit<OverlayState, "text"> = {
  xFrac: 0.06,
  yFrac: 0.05,
  wFrac: 0.88,
  fontFrac: 0.045,
  align: "center",
  caseMode: "original",
};

export interface LogoState {
  dataUrl: string;
  xFrac: number;
  yFrac: number;
  wFrac: number;
}

export const DEFAULT_LOGO: Omit<LogoState, "dataUrl"> = {
  xFrac: 0.35,
  yFrac: 0.85,
  wFrac: 0.3,
};

const logoImageCache = new Map<string, HTMLImageElement>();

function loadLogoImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = logoImageCache.get(dataUrl);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      logoImageCache.set(dataUrl, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load logo image."));
    img.src = dataUrl;
  });
}

export const FONT_STACK =
  '700 {size}px "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export function transformCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "title":
      return text
        .toLowerCase()
        .replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase());
    case "original":
    default:
      return text;
  }
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i]!;
      }
    }
    lines.push(current);
  }
  return lines;
}

export interface RenderTextOptions {
  width: number;
  height: number;
  overlay: OverlayState;
  logo?: LogoState | null;
  logoImage?: HTMLImageElement | null;
}

function drawLogoToContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  logo: LogoState,
  img: HTMLImageElement,
): void {
  const drawW = logo.wFrac * width;
  const aspect = img.naturalWidth / img.naturalHeight || 1;
  const drawH = drawW / aspect;
  const x = logo.xFrac * width;
  const y = logo.yFrac * height;
  ctx.drawImage(img, x, y, drawW, drawH);
}

export function drawOverlayToCanvas(
  canvas: HTMLCanvasElement,
  { width, height, overlay, logo, logoImage }: RenderTextOptions,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  if (logo && logoImage) {
    drawLogoToContext(ctx, width, height, logo, logoImage);
  }

  const text = transformCase(overlay.text, overlay.caseMode).trim();
  if (!text) return;

  const fontPx = Math.max(8, overlay.fontFrac * height);
  ctx.font = FONT_STACK.replace("{size}", String(fontPx));
  ctx.textBaseline = "top";

  const boxX = overlay.xFrac * width;
  const boxY = overlay.yFrac * height;
  const boxW = overlay.wFrac * width;
  const lineHeight = fontPx * 1.25;

  const lines = wrapLines(ctx, text, boxW);

  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = fontPx * 0.18;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.max(1, fontPx * 0.04);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = Math.max(1, fontPx * 0.09);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = overlay.align;

  let drawX = boxX;
  if (overlay.align === "center") drawX = boxX + boxW / 2;
  else if (overlay.align === "right") drawX = boxX + boxW;

  lines.forEach((line, i) => {
    const y = boxY + i * lineHeight;
    if (line) {
      ctx.strokeText(line, drawX, y);
      ctx.fillText(line, drawX, y);
    }
  });
}

async function renderOverlayCanvas(
  width: number,
  height: number,
  overlay: OverlayState,
  logo?: LogoState | null,
): Promise<HTMLCanvasElement> {
  if (typeof document !== "undefined" && "fonts" in document) {
    try {
      await (document as Document).fonts.ready;
    } catch {
      // ignore font loading issues
    }
  }
  let logoImage: HTMLImageElement | null = null;
  if (logo?.dataUrl) {
    try {
      logoImage = await loadLogoImage(logo.dataUrl);
    } catch {
      // ignore logo loading issues; render without it
    }
  }
  const canvas = document.createElement("canvas");
  drawOverlayToCanvas(canvas, { width, height, overlay, logo, logoImage });
  return canvas;
}

export async function generateOverlayPng(
  width: number,
  height: number,
  overlay: OverlayState,
  logo?: LogoState | null,
): Promise<Uint8Array> {
  const canvas = await renderOverlayCanvas(width, height, overlay, logo);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("Failed to generate text overlay image.");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function generateOverlayDataUrl(
  width: number,
  height: number,
  overlay: OverlayState,
  logo?: LogoState | null,
): Promise<string> {
  const canvas = await renderOverlayCanvas(width, height, overlay, logo);
  return canvas.toDataURL("image/png");
}
