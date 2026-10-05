import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import jsQR from "jsqr";

type Shape = Extract<DrawdyElementSchema, { type: "shape" }>;

export type Raster = {
    data: Uint8ClampedArray;
    width: number;
    height: number;
};

const rgb = (hex: string): [number, number, number] => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

function insideRoundedRect(
    px: number,
    py: number,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): boolean {
    if (px < x || py < y || px > x + w || py > y + h) return false;
    const radius = Math.min(r, w / 2, h / 2);
    const dx = Math.max(x + radius - px, 0, px - (x + w - radius));
    const dy = Math.max(y + radius - py, 0, py - (y + h - radius));
    return dx * dx + dy * dy <= radius * radius;
}

function insideEllipse(
    px: number,
    py: number,
    x: number,
    y: number,
    w: number,
    h: number
): boolean {
    const nx = (px - (x + w / 2)) / (w / 2);
    const ny = (py - (y + h / 2)) / (h / 2);
    return nx * nx + ny * ny <= 1;
}

// Paints shapes the way the board does at roughness 0: a solid fill plus a
// same-colour stroke centred on the outline, later elements on top.
export function rasterize(
    elements: DrawdyElementSchema[],
    pxPerUnit: number
): Raster {
    const shapes = elements.filter((e): e is Shape => e.type === "shape");
    const card = shapes[0];
    const width = Math.ceil(card.width * pxPerUnit);
    const height = Math.ceil(card.height * pxPerUnit);
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (const shape of shapes) {
        const half = (shape.strokeWidth ?? 0) / 2;
        const x = shape.x - card.x - half;
        const y = shape.y - card.y - half;
        const w = shape.width + half * 2;
        const h = shape.height + half * 2;
        const r = (shape.cornerRadius ?? 0) + (shape.cornerRadius ? half : 0);
        const [cr, cg, cb] = rgb(shape.fillColor);
        const x0 = Math.max(0, Math.floor(x * pxPerUnit));
        const y0 = Math.max(0, Math.floor(y * pxPerUnit));
        const x1 = Math.min(width, Math.ceil((x + w) * pxPerUnit));
        const y1 = Math.min(height, Math.ceil((y + h) * pxPerUnit));
        for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
                const ux = (px + 0.5) / pxPerUnit;
                const uy = (py + 0.5) / pxPerUnit;
                const hit =
                    shape.componentType === "circle"
                        ? insideEllipse(ux, uy, x, y, w, h)
                        : insideRoundedRect(ux, uy, x, y, w, h, r);
                if (!hit) continue;
                const i = (py * width + px) * 4;
                data[i] = cr;
                data[i + 1] = cg;
                data[i + 2] = cb;
                data[i + 3] = 255;
            }
        }
    }
    return { data, width, height };
}

export function decode(raster: Raster): string | null {
    const found = jsQR(raster.data, raster.width, raster.height, {
        inversionAttempts: "dontInvert",
    });
    return found ? found.data : null;
}
