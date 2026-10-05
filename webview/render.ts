import {
    CAPTION_PADDING,
    captionBlock,
    MAX_IMAGE_SIDE,
    moduleMarks,
    pixelLayout,
    spanModules,
    type Matrix,
} from "../src/shared/qr";
import { captionInk, type QrSpec } from "../src/shared/spec";
import type { PngImage } from "../src/shared/messages";

const CAPTION_FONT =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function wrapLines(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
        let line = "";
        for (const word of paragraph.split(/(\s+)/)) {
            const next = line + word;
            if (line && ctx.measureText(next.trimEnd()).width > maxWidth) {
                lines.push(line.trimEnd());
                line = word.trimStart();
            } else {
                line = next;
            }
        }
        lines.push(line.trimEnd());
    }
    return lines.filter((l, i) => l || i < lines.length - 1);
}

type Frame = {
    width: number;
    height: number;
    unit: number;
    captionLines: string[];
    fontPx: number;
};

// unit is pixels per board unit; the code always spans spec.size board units.
function frameFor(
    ctx: CanvasRenderingContext2D,
    spec: QrSpec,
    unit: number,
    exactCaption: boolean
): Frame {
    const width = spec.size * unit;
    const caption = spec.caption.trim();
    const block = captionBlock(caption, spec.size);
    if (!caption) {
        return { width, height: width, unit, captionLines: [], fontPx: 0 };
    }
    const fontPx = block.fontSize * unit;
    ctx.font = `${fontPx}px ${CAPTION_FONT}`;
    const lines = wrapLines(
        ctx,
        caption,
        (spec.size - CAPTION_PADDING * 2) * unit
    );
    const captionHeight = exactCaption
        ? Math.ceil(
              (lines.length * block.fontSize * 1.4 + CAPTION_PADDING) * unit
          )
        : block.height * unit;
    return {
        width,
        height: width + captionHeight,
        unit,
        captionLines: lines,
        fontPx,
    };
}

function roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): void {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function paint(
    ctx: CanvasRenderingContext2D,
    matrix: Matrix,
    spec: QrSpec,
    frame: Frame,
    modulePx: number
): void {
    ctx.fillStyle = spec.bg;
    ctx.fillRect(0, 0, frame.width, frame.height);
    const origin = spec.quiet * modulePx;
    for (const mark of moduleMarks(matrix, spec.style)) {
        ctx.fillStyle = mark.tone === "fg" ? spec.fg : spec.bg;
        const x = origin + mark.x * modulePx;
        const y = origin + mark.y * modulePx;
        const w = mark.w * modulePx;
        const h = mark.h * modulePx;
        if (mark.shape === "rect" && mark.radius === 0) {
            ctx.fillRect(x, y, w, h);
            continue;
        }
        ctx.beginPath();
        if (mark.shape === "circle") {
            ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        } else {
            roundedRect(ctx, x, y, w, h, mark.radius * modulePx);
        }
        ctx.fill();
    }
    if (frame.captionLines.length === 0) return;
    const lineHeight = frame.fontPx * 1.4;
    ctx.fillStyle = captionInk(spec.bg);
    ctx.font = `${frame.fontPx}px ${CAPTION_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const top =
        frame.height -
        CAPTION_PADDING * frame.unit -
        frame.captionLines.length * lineHeight;
    frame.captionLines.forEach((line, i) => {
        ctx.fillText(line, frame.width / 2, top + (i + 0.5) * lineHeight);
    });
}

export function drawPreview(
    canvas: HTMLCanvasElement,
    matrix: Matrix,
    spec: QrSpec,
    box: { width: number; height: number }
): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const exact = spec.output === "image";
    const probe = frameFor(ctx, spec, 1, exact);
    const fit = Math.min(box.width / probe.width, box.height / probe.height);
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssWidth = Math.floor(probe.width * fit);
    const cssHeight = Math.floor(probe.height * fit);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    const unit = canvas.width / spec.size;
    const frame = frameFor(ctx, spec, unit, exact);
    frame.height = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paint(
        ctx,
        matrix,
        spec,
        frame,
        canvas.width / spanModules(matrix, spec.quiet)
    );
}

export function pngSize(
    matrix: Matrix,
    spec: QrSpec
): { width: number; height: number } {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const layout = pixelLayout(matrix, spec);
    if (!ctx) return { width: layout.codePx, height: layout.codePx };
    const frame = frameFor(ctx, spec, layout.scale, true);
    return { width: layout.codePx, height: Math.ceil(frame.height) };
}

export function renderPng(matrix: Matrix, spec: QrSpec): PngImage | null {
    const layout = pixelLayout(matrix, spec);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const frame = frameFor(ctx, spec, layout.scale, true);
    canvas.width = layout.codePx;
    canvas.height = Math.min(MAX_IMAGE_SIDE, Math.ceil(frame.height));
    frame.height = canvas.height;
    paint(ctx, matrix, spec, frame, layout.modulePx);
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png")) return null;
    return {
        dataUrl,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
    };
}
