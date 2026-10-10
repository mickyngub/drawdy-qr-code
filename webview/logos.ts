import type { PngImage } from "../src/shared/messages";
import { LOGO_IMAGE_MAX, type Settings } from "../src/shared/spec";

const DRAWDY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="224" fill="#090909"/><g transform="translate(88.247 283.825) scale(32.596395)"><path fill="#C5F601" fill-rule="evenodd" d="M14.752.003c.634-.02 1.2.064 1.713.477 1.205.974 1.134 2.722.833 4.092-.499 2.275-1.654 4.398-3.18 6.148-.146.168-.344.326-.475.5l-.01.016c.332.375 1.074.646 1.558.693 1.384.135 2.745-.514 3.822-1.308-.379-.7-.555-1.68-.568-2.476-.007-1.64.49-3.193 1.597-4.418 1.136-1.256 3.374-1.362 3.968.476.733 2.268-.904 5.168-2.476 6.733.829.839 1.813.938 2.848.384.156-.084.3-.184.454-.27.224.457.42.936.646 1.394.067.134.136.277.188.416-1.466.968-3.61 1.014-4.985-.115a6 6 0 0 1-.504-.477c-.157.11-.303.233-.46.345q-.512.368-1.08.644c-1.535.737-3.214 1.007-4.848.434a4.3 4.3 0 0 1-1.702-1.078c-.134.08-.262.183-.394.268-2.313 1.496-5.353 1.601-7.269-.599a4.7 4.7 0 0 1-1.616.97c-.857.309-1.979.342-2.812-.048.187-.317.366-.753.54-1.087.065-.123.318-.635.35-.746 1.033.289 1.68-.048 2.476-.658-1.046-2.004-.751-4.834.61-6.648 1.43-1.903 4.128-1.73 4.357.943a4 4 0 0 1-.064 1.112c-.274 1.598-1.059 3.078-2.104 4.305-.13.153-.272.297-.399.454 1.166 1.34 2.903 1.252 4.377.483.254-.133.495-.292.744-.422-.56-1.005-.683-2.638-.625-3.769.128-2.476 1.61-6.817 4.49-7.168m.482 2.429c-.076-.193-.278-.32-.478-.264-.749.343-1.334 1.492-1.595 2.23-.515 1.456-.85 3.373-.518 4.902q.093-.12.192-.238c1.093-1.391 1.896-2.94 2.298-4.67.12-.514.311-1.428.101-1.96m6.726 2.16c-1.28.495-1.747 3.454-1.305 4.61l.005.011.118-.143c.677-.86 1.202-1.838 1.45-2.909.076-.328.242-1.515-.268-1.57m-15.826.001c-.552.242-.877.866-1.094 1.4-.373.916-.486 2.26-.19 3.214l.122-.135A7 7 0 0 0 6.424 6.19c.037-.156.082-.33.1-.488.035-.3.077-1.143-.39-1.11"/></g></svg>`;

export const DRAWDY_LOGO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DRAWDY_SVG)}`;

const BOARD_PX = 512;
const UPLOAD_PX = 256;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export function logoSource(
    settings: Pick<Settings, "logo" | "logoImage">
): string | null {
    if (settings.logo === "drawdy") return DRAWDY_LOGO_URL;
    if (settings.logo === "custom") return settings.logoImage || null;
    return null;
}

const images = new Map<string, HTMLImageElement>();

/** The decoded picture, or null while it loads; onReady runs once it can be drawn. */
export function loadedLogo(
    src: string,
    onReady: () => void
): HTMLImageElement | null {
    let img = images.get(src);
    if (!img) {
        img = new Image();
        images.set(src, img);
        img.src = src;
    }
    if (img.complete && img.naturalWidth > 0) return img;
    img.addEventListener("load", onReady, { once: true });
    return null;
}

export function drawContained(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    side: number
): void {
    const w = img.naturalWidth || side;
    const h = img.naturalHeight || side;
    const scale = side / Math.max(w, h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, x + (side - dw) / 2, y + (side - dh) / 2, dw, dh);
}

function squarePng(img: HTMLImageElement, side: number): string | null {
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawContained(ctx, img, 0, 0, side);
    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.startsWith("data:image/png") ? dataUrl : null;
}

/** The picture as the board gets it: uploads are already square PNGs, the built-in logo is drawn once. */
export function logoPng(src: string, img: HTMLImageElement): PngImage | null {
    if (src.startsWith("data:image/png")) {
        return {
            dataUrl: src,
            pixelWidth: img.naturalWidth,
            pixelHeight: img.naturalHeight,
        };
    }
    const dataUrl = squarePng(img, BOARD_PX);
    return dataUrl
        ? { dataUrl, pixelWidth: BOARD_PX, pixelHeight: BOARD_PX }
        : null;
}

const readAsDataUrl = (file: File): Promise<string | null> =>
    new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () =>
            resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });

/** An uploaded file as a small square PNG data URL, or null when it is not a picture. */
export async function readPicture(file: File): Promise<string | null> {
    if (!file.type.startsWith("image/") || file.size > UPLOAD_MAX_BYTES) {
        return null;
    }
    const source = await readAsDataUrl(file);
    if (!source) return null;
    const img = new Image();
    img.src = source;
    try {
        await img.decode();
    } catch {
        return null;
    }
    const png = squarePng(img, UPLOAD_PX);
    return png && png.length <= LOGO_IMAGE_MAX ? png : null;
}
