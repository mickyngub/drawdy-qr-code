import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import { qrcodegen } from "../vendor/qrcodegen";
import { captionInk, type Ecc, type ModuleStyle, type QrSpec } from "./spec";

export const MAX_ELEMENTS = 3000;
export const BATCH_SIZE = 500;
export const CAPTION_PADDING = 8;
export const MAX_IMAGE_SIDE = 2048;
const STROKE = 1;
const IMAGE_TARGET_SIDE = 1024;

export type Matrix = {
    version: number;
    size: number;
    modules: boolean[][];
};

const ECC: Record<Ecc, qrcodegen.QrCode.Ecc> = {
    L: qrcodegen.QrCode.Ecc.LOW,
    M: qrcodegen.QrCode.Ecc.MEDIUM,
    Q: qrcodegen.QrCode.Ecc.QUARTILE,
    H: qrcodegen.QrCode.Ecc.HIGH,
};

export function encodeMatrix(payload: string, ecc: Ecc): Matrix | null {
    let qr: qrcodegen.QrCode;
    try {
        // boostEcl is off so the level the person picked is the level they get.
        qr = qrcodegen.QrCode.encodeSegments(
            qrcodegen.QrSegment.makeSegments(payload),
            ECC[ecc],
            1,
            40,
            -1,
            false
        );
    } catch {
        return null;
    }
    const modules: boolean[][] = [];
    for (let y = 0; y < qr.size; y++) {
        const row: boolean[] = [];
        for (let x = 0; x < qr.size; x++) row.push(qr.getModule(x, y));
        modules.push(row);
    }
    return { version: qr.version, size: qr.size, modules };
}

export type Run = { row: number; start: number; length: number };

export function rowRuns(modules: boolean[][]): Run[] {
    const runs: Run[] = [];
    modules.forEach((line, row) => {
        let start = -1;
        for (let x = 0; x <= line.length; x++) {
            const dark = x < line.length && line[x];
            if (dark && start < 0) start = x;
            if (!dark && start >= 0) {
                runs.push({ row, start, length: x - start });
                start = -1;
            }
        }
    });
    return runs;
}

export type Cell = { x: number; y: number; w: number; h: number };

const transpose = (modules: boolean[][]): boolean[][] =>
    modules.map((_, x) => modules.map((row) => row[x]));

// Row runs plus column runs: any two touching dark modules share one
// unbroken rect, so the board never shows a seam between them and no rect
// has to overlap into a light module to hide one.
export function squareCells(modules: boolean[][]): Cell[] {
    const columns = rowRuns(transpose(modules)).filter((r) => r.length > 1);
    const inColumn = new Set<number>();
    for (const c of columns) {
        for (let y = c.start; y < c.start + c.length; y++) {
            inColumn.add(y * modules.length + c.row);
        }
    }
    const cells: Cell[] = [];
    for (const r of rowRuns(modules)) {
        if (r.length === 1 && inColumn.has(r.row * modules.length + r.start)) {
            continue;
        }
        cells.push({ x: r.start, y: r.row, w: r.length, h: 1 });
    }
    for (const c of columns) {
        cells.push({ x: c.row, y: c.start, w: 1, h: c.length });
    }
    return cells;
}

export type Mark = {
    shape: "rect" | "circle";
    x: number;
    y: number;
    w: number;
    h: number;
    radius: number;
    tone: "fg" | "bg";
};

function inFinder(x: number, y: number, size: number): boolean {
    const far = size - 7;
    return (x < 7 && y < 7) || (x >= far && y < 7) || (x < 7 && y >= far);
}

function finderMarks(size: number, style: ModuleStyle): Mark[] {
    const round = style === "dots" ? [2.5, 1.8] : [2, 1.4];
    const marks: Mark[] = [];
    for (const [fx, fy] of [
        [0, 0],
        [size - 7, 0],
        [0, size - 7],
    ]) {
        marks.push(
            {
                shape: "rect",
                x: fx,
                y: fy,
                w: 7,
                h: 7,
                radius: round[0],
                tone: "fg",
            },
            {
                shape: "rect",
                x: fx + 1,
                y: fy + 1,
                w: 5,
                h: 5,
                radius: round[1],
                tone: "bg",
            },
            style === "dots"
                ? {
                      shape: "circle",
                      x: fx + 2,
                      y: fy + 2,
                      w: 3,
                      h: 3,
                      radius: 0,
                      tone: "fg",
                  }
                : {
                      shape: "rect",
                      x: fx + 2,
                      y: fy + 2,
                      w: 3,
                      h: 3,
                      radius: 0.9,
                      tone: "fg",
                  }
        );
    }
    return marks;
}

const DOT = 0.84;
const ROUNDED = 0.9;
const ROUNDED_RADIUS = 0.3;

// Coordinates are in modules from the top-left module, quiet zone excluded.
// Dots and Rounded keep solid finder patterns because scanners look for their
// 1:1:3:1:1 stripes and loose dots break them.
export function moduleMarks(matrix: Matrix, style: ModuleStyle): Mark[] {
    if (style === "square") {
        return squareCells(matrix.modules).map((cell) => ({
            shape: "rect",
            ...cell,
            radius: 0,
            tone: "fg",
        }));
    }
    const marks = finderMarks(matrix.size, style);
    const side = style === "dots" ? DOT : ROUNDED;
    const offset = (1 - side) / 2;
    matrix.modules.forEach((line, y) => {
        line.forEach((dark, x) => {
            if (!dark || inFinder(x, y, matrix.size)) return;
            marks.push({
                shape: style === "dots" ? "circle" : "rect",
                x: x + offset,
                y: y + offset,
                w: side,
                h: side,
                radius: style === "dots" ? 0 : ROUNDED_RADIUS,
                tone: "fg",
            });
        });
    });
    return marks;
}

export function elementCount(matrix: Matrix, style: ModuleStyle): number {
    return 1 + moduleMarks(matrix, style).length;
}

export type CaptionBlock = { fontSize: number; height: number; lines: number };

const isWide = (code: number): boolean =>
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    code >= 0x1f300;

export function captionFontSize(size: number): number {
    return Math.min(64, Math.max(12, Math.round(size * 0.07)));
}

// The board draws captions in its handwriting font, which the driver cannot
// measure, so the line count is a generous estimate of character widths.
export function captionBlock(caption: string, size: number): CaptionBlock {
    const trimmed = caption.trim();
    if (!trimmed) return { fontSize: 0, height: 0, lines: 0 };
    const fontSize = captionFontSize(size);
    let width = 0;
    for (const char of trimmed) {
        width += fontSize * (isWide(char.codePointAt(0) ?? 0) ? 1.05 : 0.62);
    }
    const lines = Math.max(1, Math.ceil(width / (size - CAPTION_PADDING * 2)));
    return {
        fontSize,
        lines,
        height: Math.ceil(lines * fontSize * 1.4 + CAPTION_PADDING),
    };
}

export function spanModules(matrix: Matrix, quiet: number): number {
    return matrix.size + quiet * 2;
}

export type ElementPlan = {
    matrix: Matrix;
    spec: QrSpec;
    x: number;
    y: number;
    driverId: string;
    nextId: () => string;
};

export function buildElements(plan: ElementPlan): DrawdyElementSchema[] {
    const { matrix, spec, driverId, nextId } = plan;
    const unit = spec.size / spanModules(matrix, spec.quiet);
    const caption = captionBlock(spec.caption, spec.size);
    const groupId = nextId();
    const part = { [driverId]: { v: 1, part: true } };
    const colour = { fg: spec.fg, bg: spec.bg };

    const card: DrawdyElementSchema = {
        type: "shape",
        componentType: "rect",
        drawdyElementId: nextId(),
        groupId,
        x: plan.x,
        y: plan.y,
        width: spec.size,
        height: spec.size + caption.height,
        strokeColor: spec.bg,
        fillColor: spec.bg,
        fillStyle: "solid",
        strokeWidth: 1,
        cornerRadius: 0,
        roughness: 0,
        meta: { [driverId]: { v: 1, spec } },
    };
    if (caption.lines > 0) {
        Object.assign(card, {
            text: spec.caption.trim(),
            fontSize: caption.fontSize,
            textColor: captionInk(spec.bg),
            textAlign: "center",
            textVerticalAlign: "bottom",
        });
    }

    const ox = plan.x + spec.quiet * unit;
    const oy = plan.y + spec.quiet * unit;
    // The stroke is centred on the outline, so each mark is inset by half of
    // it to keep its true size: a stroke that grows every dark module stops
    // scanners reading small codes.
    const elements: DrawdyElementSchema[] = [card];
    for (const mark of moduleMarks(matrix, spec.style)) {
        const w = mark.w * unit;
        const h = mark.h * unit;
        const px = w > STROKE * 2 ? STROKE / 2 : 0;
        const py = h > STROKE * 2 ? STROKE / 2 : 0;
        const fill = colour[mark.tone];
        elements.push({
            type: "shape",
            componentType: mark.shape,
            drawdyElementId: nextId(),
            groupId,
            x: ox + mark.x * unit + px,
            y: oy + mark.y * unit + py,
            width: w - px * 2,
            height: h - py * 2,
            strokeColor: fill,
            fillColor: fill,
            fillStyle: "solid",
            strokeWidth: STROKE,
            cornerRadius: Math.max(
                0,
                Math.min(mark.radius * unit - px, (w - px * 2) / 2)
            ),
            roughness: 0,
            meta: part,
        });
    }
    return elements;
}

export type PixelLayout = {
    modulePx: number;
    codePx: number;
    scale: number;
};

export function pixelLayout(matrix: Matrix, spec: QrSpec): PixelLayout {
    const span = spanModules(matrix, spec.quiet);
    const modulePx = Math.max(1, Math.floor(IMAGE_TARGET_SIDE / span));
    const codePx = span * modulePx;
    return { modulePx, codePx, scale: codePx / spec.size };
}

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

export const TOO_LONG_MESSAGE =
    "That is too much for one QR code. Shorten it, or pick a lower error correction.";

export function tooManyShapesMessage(count: number): string {
    return `This code needs ${count.toLocaleString("en-US")} shapes, and one placement takes ${MAX_ELEMENTS.toLocaleString("en-US")} at most. Pick Square, shorten the content, or place it as an image.`;
}
