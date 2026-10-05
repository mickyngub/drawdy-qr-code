import type {
    DrawdyElementSchema,
    DriverCommandIssuer,
    DriverManifest,
    DriverModule,
    ModuleStyling,
    SubscribeableKey,
    SubscribedDrawdyElement,
} from "@drawdy/driver-protocol";
import type {
    DriverToWebview,
    PngImage,
    Rect,
    WebviewToDriver,
} from "./shared/messages";
import { buildPayload } from "./shared/payload";
import {
    batches,
    buildElements,
    captionBlock,
    elementCount,
    encodeMatrix,
    MAX_ELEMENTS,
    TOO_LONG_MESSAGE,
    tooManyShapesMessage,
} from "./shared/qr";
import { normalizeSpec, SIZE_MAX, SIZE_MIN, type QrSpec } from "./shared/spec";
import { WEBVIEW_HTML } from "./webview-html";

// Drawdy shows this through <img>, where currentColor is black, so the colours are explicit.
const ACTION_BUTTON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#047857"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="6" fill="url(#g)"/><g fill="#ffffff" transform="translate(12 12) scale(0.72) translate(-12 -12)"><path fill-rule="evenodd" d="M3 3h7v7H3zM4.5 4.5v4h4v-4zM5.5 5.5h2v2h-2zM14 3h7v7h-7zM15.5 4.5v4h4v-4zM16.5 5.5h2v2h-2zM3 14h7v7H3zM4.5 15.5v4h4v-4zM5.5 16.5h2v2h-2z"/><path d="M14 14h2.33v2.33H14zM18.67 14H21v2.33h-2.33zM16.33 16.33h2.34v2.34h-2.34zM14 18.67h2.33V21H14zM18.67 18.67H21V21h-2.33z"/></g></svg>`;

const SETTINGS_KV_KEY = "settings";
const FLY_DURATION_MS = 350;

type Editing = { ids: string[]; x: number; y: number };

let requestId = 0;
let selectionCheck = 0;

let driver: {
    manifest: DriverManifest;
    issueCommand: DriverCommandIssuer;
    generateId: () => string;
    styling: ModuleStyling;
    actionButtonId: string;
    webviewId: string;
    webviewHtml: string | null;
    webviewOpen: boolean;
    settings: Record<string, unknown> | null;
    selection: string[];
    editable: boolean;
    editing: Editing | null;
} | null = null;

let chain: Promise<void> = Promise.resolve();

const nextRequestId = (): string => String(requestId++);

function stylingCssVars(styling: ModuleStyling): string {
    return Object.entries(styling)
        .map(([key, value]) =>
            key === "theme"
                ? `color-scheme: ${value};`
                : `--drawdy-${key.replace(
                      /[A-Z]/g,
                      (c) => `-${c.toLowerCase()}`
                  )}: ${value};`
        )
        .join("");
}

function enqueue(task: () => Promise<void>): Promise<void> {
    const next = chain.then(task).catch(() => undefined);
    chain = next;
    return next;
}

function post(message: DriverToWebview): void {
    if (!driver) return;
    void driver.issueCommand({
        type: "command:webview:post-message",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: { webviewDomId: driver.webviewId, message },
    });
}

function ownMeta(
    meta: Record<string, unknown> | undefined
): Record<string, unknown> | null {
    if (!driver || !meta) return null;
    const own = meta[driver.manifest.driverId];
    if (!own || typeof own !== "object") return null;
    const record = own as Record<string, unknown>;
    return record.v === 1 ? record : null;
}

export const activate: DriverModule["activate"] = async ({
    manifest,
    issueCommand,
    styling,
    generateId,
}) => {
    driver = {
        manifest,
        issueCommand,
        generateId,
        styling,
        actionButtonId: `${manifest.driverId}:action-button`,
        webviewId: `${manifest.driverId}:webview`,
        webviewHtml: null,
        webviewOpen: false,
        settings: null,
        selection: [],
        editable: false,
        editing: null,
    };
    const { driverId } = manifest;

    const created = await issueCommand({
        type: "command:dom:create-action-button",
        driverId,
        requestId: nextRequestId(),
        req: { domElementId: driver.actionButtonId, svg: ACTION_BUTTON_SVG },
    });
    if (created.res.error !== undefined) return;

    await Promise.all([
        issueCommand({
            type: "subscription:dom:element-clicked",
            driverId,
            requestId: nextRequestId(),
            req: { domElementId: driver.actionButtonId },
        }),
        issueCommand({
            type: "subscription:webview:message",
            driverId,
            requestId: nextRequestId(),
            req: { webviewDomId: driver.webviewId },
        }),
        issueCommand({
            type: "subscription:dom:theme-changed",
            driverId,
            requestId: nextRequestId(),
        }),
        issueCommand({
            type: "subscription:scene:drawdy-element-selection",
            driverId,
            requestId: nextRequestId(),
        }),
    ]);

    const stored = await issueCommand({
        type: "command:kv-storage:get",
        driverId,
        requestId: nextRequestId(),
        req: { key: SETTINGS_KV_KEY },
    });
    if (driver && stored.res.error === undefined) {
        const restored = stored.res.value?.got?.[SETTINGS_KV_KEY];
        if (restored && typeof restored === "object") {
            driver.settings = restored as Record<string, unknown>;
        }
    }
};

export const onEvent: DriverModule["onEvent"] = async (event) => {
    if (!driver) return;
    switch (event.type) {
        case "subscription:dom:element-clicked": {
            if (event.body.domElementId !== driver.actionButtonId) return;
            await enqueue(openWebview);
            return;
        }
        case "subscription:webview:message": {
            if (event.body.webviewDomId !== driver.webviewId) return;
            const message = event.body.message;
            if (typeof message !== "object" || message === null) return;
            await handleWebviewMessage(message as WebviewToDriver);
            return;
        }
        case "subscription:dom:theme-changed": {
            driver.styling = event.body.styling;
            if (!driver.webviewOpen) driver.webviewHtml = null;
            post({ type: "theme", css: stylingCssVars(driver.styling) });
            return;
        }
        case "subscription:scene:drawdy-element-selection": {
            driver.selection = event.body.drawdyElementIds;
            await checkSelection();
            return;
        }
        default: {
            return;
        }
    }
};

async function openWebview(): Promise<void> {
    if (!driver) return;
    if (driver.webviewHtml === null) {
        driver.webviewHtml = WEBVIEW_HTML.replace(
            "/*__DRAWDY_STYLING__*/",
            stylingCssVars(driver.styling)
        );
    }
    await driver.issueCommand({
        type: "command:webview:create",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: {
            webviewDomId: driver.webviewId,
            htmlContent: driver.webviewHtml,
            keepStateWhenClosed: true,
        },
    });
    if (driver) driver.webviewOpen = true;
}

async function readElements(
    properties: SubscribeableKey[],
    ids?: string[]
): Promise<SubscribedDrawdyElement[]> {
    if (!driver) return [];
    const res = await driver.issueCommand({
        type: "command:scene:get-drawdy-elements",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: ids ? { properties, drawdyElementIds: ids } : { properties },
    });
    if (res.res.error !== undefined) return [];
    return res.res.value.drawdyElements;
}

async function checkSelection(): Promise<void> {
    if (!driver) return;
    const check = ++selectionCheck;
    const ids = driver.selection;
    const editable =
        ids.length > 0 &&
        (await readElements(["meta"], ids)).some((e) => ownMeta(e.meta));
    if (!driver || check !== selectionCheck) return;
    if (editable === driver.editable) return;
    driver.editable = editable;
    post({ type: "selection", editable });
}

async function handleWebviewMessage(message: WebviewToDriver): Promise<void> {
    if (!driver) return;
    switch (message.type) {
        case "ready": {
            driver.webviewOpen = true;
            post({
                type: "init",
                settings: driver.settings ?? undefined,
                editable: driver.editable,
            });
            return;
        }
        case "settings": {
            const settings = message.settings;
            if (typeof settings !== "object" || settings === null) return;
            driver.settings = settings;
            await driver.issueCommand({
                type: "command:kv-storage:set",
                driverId: driver.manifest.driverId,
                requestId: nextRequestId(),
                req: {
                    key: SETTINGS_KV_KEY,
                    payload: { [SETTINGS_KV_KEY]: settings },
                },
            });
            return;
        }
        case "place": {
            await enqueue(() => place(message.spec, message.image, null));
            return;
        }
        case "edit": {
            await enqueue(startEdit);
            return;
        }
        case "update": {
            await enqueue(async () => {
                if (!driver) return;
                if (!driver.editing) {
                    post({
                        type: "error",
                        message: "Select a code and click Edit selected first.",
                    });
                    return;
                }
                await place(message.spec, message.image, driver.editing);
            });
            return;
        }
        case "stop-edit": {
            driver.editing = null;
            return;
        }
        case "close": {
            driver.webviewOpen = false;
            await driver.issueCommand({
                type: "command:webview:hide",
                driverId: driver.manifest.driverId,
                requestId: nextRequestId(),
                req: { webviewDomId: driver.webviewId },
            });
            return;
        }
    }
}

function bounds(
    element: SubscribedDrawdyElement
): { x: number; y: number; width: number } | null {
    const points = element.points ?? [];
    if (element.type === "image" || points.length < 2) {
        const point = points[0];
        const x = point?.[0] ?? element.x;
        const y = point?.[1] ?? element.y;
        if (x === undefined || y === undefined) return null;
        return { x, y, width: element.width ?? 0 };
    }
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs);
    return { x, y: Math.min(...ys), width: Math.max(...xs) - x };
}

async function startEdit(): Promise<void> {
    if (!driver) return;
    const current = await driver.issueCommand({
        type: "command:scene:get-current-selected-drawdy-elements",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
    });
    const ids =
        current.res.error === undefined
            ? current.res.value.drawdyElementIds
            : driver.selection;
    const ours = (await readElements(["groupId", "meta"], ids)).filter((e) =>
        ownMeta(e.meta)
    );
    if (ours.length === 0) {
        post({
            type: "error",
            message: "Select a QR code you made with this extension first.",
        });
        return;
    }
    const groupId = ours.find((e) => e.groupId)?.groupId;
    const members = groupId
        ? (await readElements(["groupId", "meta"])).filter(
              (e) => e.groupId === groupId && ownMeta(e.meta)
          )
        : ours;
    const head = members.find((e) => {
        const own = ownMeta(e.meta);
        return own !== null && ("spec" in own || "params" in own);
    });
    const own = head ? ownMeta(head.meta) : null;
    if (!head || !own) {
        post({
            type: "error",
            message:
                "This code has lost its settings, so it cannot be edited. Make a new one instead.",
        });
        return;
    }
    const [placed] = await readElements(
        ["type", "points", "width", "x", "y"],
        [head.id]
    );
    const box = placed ? bounds(placed) : null;
    if (!driver || !box) return;
    const spec = normalizeSpec(own.spec ?? own.params);
    if (Math.abs(box.width - spec.size) > 1) {
        spec.size = Math.round(
            Math.min(SIZE_MAX, Math.max(SIZE_MIN, box.width))
        );
    }
    driver.editing = { ids: members.map((e) => e.id), x: box.x, y: box.y };
    post({ type: "load", spec });
}

async function viewCentredRect(width: number, height: number): Promise<Rect> {
    if (!driver) return { x: 0, y: 0, width, height };
    const res = await driver.issueCommand({
        type: "command:camera:get-viewport-rect",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
    });
    if (res.res.error !== undefined) return { x: 0, y: 0, width, height };
    const { rect } = res.res.value;
    return {
        x: rect.x + (rect.width - width) / 2,
        y: rect.y + (rect.height - height) / 2,
        width,
        height,
    };
}

type Built =
    | { ok: true; elements: DrawdyElementSchema[] }
    | { ok: false; message: string };

function buildImage(
    spec: QrSpec,
    image: PngImage | undefined,
    x: number,
    y: number
): Built {
    if (!driver) return { ok: false, message: "" };
    if (
        !image ||
        typeof image.dataUrl !== "string" ||
        !image.dataUrl.startsWith("data:image/png") ||
        !(image.pixelWidth > 0) ||
        !(image.pixelHeight > 0)
    ) {
        return { ok: false, message: "That image could not be read." };
    }
    return {
        ok: true,
        elements: [
            {
                type: "image",
                drawdyElementId: driver.generateId(),
                url: image.dataUrl,
                x,
                y,
                width: spec.size,
                height: spec.size * (image.pixelHeight / image.pixelWidth),
                meta: {
                    [driver.manifest.driverId]: { v: 1, params: spec },
                },
            },
        ],
    };
}

async function place(
    rawSpec: unknown,
    image: PngImage | undefined,
    target: Editing | null
): Promise<void> {
    if (!driver) return;
    const spec = normalizeSpec(rawSpec);
    const { driverId } = driver.manifest;

    let height = spec.size;
    let build: (x: number, y: number) => Built;
    if (spec.output === "image") {
        const ratio =
            image && image.pixelWidth > 0
                ? image.pixelHeight / image.pixelWidth
                : 1;
        height = spec.size * ratio;
        build = (x, y) => buildImage(spec, image, x, y);
    } else {
        const payload = buildPayload(spec.content, spec.fields);
        if (!payload.ok) {
            post({ type: "error", message: payload.message });
            return;
        }
        const matrix = encodeMatrix(payload.payload, spec.ecc);
        if (!matrix) {
            post({ type: "error", message: TOO_LONG_MESSAGE });
            return;
        }
        const count = elementCount(matrix, spec.style);
        if (count > MAX_ELEMENTS) {
            post({ type: "error", message: tooManyShapesMessage(count) });
            return;
        }
        height = spec.size + captionBlock(spec.caption, spec.size).height;
        build = (x, y) => ({
            ok: true,
            elements: buildElements({
                matrix,
                spec,
                x,
                y,
                driverId,
                nextId: driver!.generateId,
            }),
        });
    }

    const origin = target ?? (await viewCentredRect(spec.size, height));
    if (!driver) return;
    const built = build(origin.x, origin.y);
    if (!built.ok) {
        post({ type: "error", message: built.message });
        return;
    }

    const ids = built.elements.map((e) => e.drawdyElementId);
    const added: string[] = [];
    for (const batch of batches(built.elements)) {
        const res = await driver.issueCommand({
            type: "command:scene:add-drawdy-elements",
            driverId,
            requestId: nextRequestId(),
            req: { elements: batch },
        });
        if (!driver) return;
        if (res.res.error !== undefined) {
            if (added.length > 0) {
                await driver.issueCommand({
                    type: "command:scene:remove-drawdy-elements",
                    driverId,
                    requestId: nextRequestId(),
                    req: { drawdyElementIds: added },
                });
            }
            post({ type: "error", message: "The board rejected that code." });
            return;
        }
        added.push(...batch.map((e) => e.drawdyElementId));
    }

    if (target) {
        await driver.issueCommand({
            type: "command:scene:remove-drawdy-elements",
            driverId,
            requestId: nextRequestId(),
            req: { drawdyElementIds: target.ids },
        });
        if (!driver) return;
        driver.editing = { ids, x: origin.x, y: origin.y };
        await driver.issueCommand({
            type: "command:scene:set-selection",
            driverId,
            requestId: nextRequestId(),
            req: { drawdyElementIds: ids },
        });
    }

    await driver?.issueCommand({
        type: "command:camera:fly-to-elements",
        driverId,
        requestId: nextRequestId(),
        req: {
            drawdyElementIds: [ids[0]],
            flyDurationMs: FLY_DURATION_MS,
            zoom: 1,
        },
    });
    post({ type: "placed", updated: target !== null, count: ids.length });
}
