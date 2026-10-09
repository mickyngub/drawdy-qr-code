import type {
    DrawdyElementSchema,
    DriverCommandIssuer,
    DriverManifest,
    DriverModule,
    ModuleStyling,
    SubscribeableKey,
    SubscribedDrawdyElement,
} from "@drawdy/driver-protocol";
import {
    centredIn,
    findFreeRect,
    revealAndSelect,
    visibleArea,
} from "./lib/free-spot";
import type {
    DriverToWebview,
    PngImage,
    Rect,
    WebviewToDriver,
} from "./shared/messages";
import { buildPayload } from "./shared/payload";
import {
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

export const NEEDS_PERMISSION =
    "QR Code needs permission to read the board. Reload the page and click Allow.";
export const BOARD_FULL =
    "The board is full: it holds at most 10,000 elements. Remove some, then try again.";

const MEMBER_KEYS: SubscribeableKey[] = [
    "type",
    "meta",
    "points",
    "x",
    "y",
    "width",
    "rotation",
    "opacity",
    "layer",
    "frameId",
    "groupId",
    "locked",
];

/** What Edit selected found: the code's parts, and its width then, to tell a later resize on the board. */
type Editing = { ids: string[]; groupId: string | null; width: number };

class PermissionDenied extends Error {}

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
    panelReady: boolean;
    started: boolean;
    settings: Record<string, unknown> | null;
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

function reportFailure(err: unknown): void {
    if (err instanceof PermissionDenied) {
        post({ type: "error", message: NEEDS_PERMISSION });
        return;
    }
    const detail = err instanceof Error && err.message ? err.message : "";
    post({
        type: "error",
        message: `Something went wrong${
            detail ? ` (${detail.slice(0, 80)})` : ""
        }. Try again.`,
    });
}

function enqueue(task: () => Promise<void>): Promise<void> {
    const next = chain.then(task).catch(reportFailure);
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

function placeCtx() {
    const d = driver as NonNullable<typeof driver>;
    return {
        issueCommand: d.issueCommand,
        driverId: d.manifest.driverId,
        nextRequestId,
        webviewDomId: d.webviewId,
    };
}

function denied(res: { res: { error?: { type: string } } }): boolean {
    return res.res.error?.type === "unauthorized";
}

// The published protocol package predates the history commands, so they go through untyped.
async function history(type: "undo" | "redo"): Promise<void> {
    if (!driver) return;
    const res = (await driver.issueCommand({
        type: `command:history:${type}`,
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
    } as unknown as Parameters<DriverCommandIssuer>[0])) as {
        res: { error?: { type: string } };
    };
    if (denied(res)) throw new PermissionDenied();
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

const isHead = (e: SubscribedDrawdyElement): boolean => {
    const own = ownMeta(e.meta);
    return own !== null && ("spec" in own || "params" in own);
};

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
        panelReady: false,
        started: false,
        settings: null,
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
    ]);
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
            if (driver.panelReady) {
                post({ type: "theme", css: stylingCssVars(driver.styling) });
            }
            return;
        }
        case "subscription:scene:drawdy-element-selection": {
            if (!driver.webviewOpen || !driver.panelReady) return;
            await reportSelection(event.body.drawdyElementIds).catch(
                reportFailure
            );
            return;
        }
        default: {
            return;
        }
    }
};

// The panel is kept alive while closed and never reloads, so a theme switch reaches it by message.
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
    if (!driver) return;
    driver.webviewOpen = true;
    if (driver.panelReady) {
        post({ type: "theme", css: stylingCssVars(driver.styling) });
        await reportSelection(await selectedIds());
    }
}

async function start(): Promise<void> {
    if (!driver || driver.started) return;
    driver.started = true;
    const { driverId } = driver.manifest;
    const stored = await driver.issueCommand({
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
    await driver?.issueCommand({
        type: "subscription:scene:drawdy-element-selection",
        driverId,
        requestId: nextRequestId(),
    });
}

async function onReady(): Promise<void> {
    if (!driver) return;
    driver.panelReady = true;
    driver.webviewOpen = true;
    await start();
    if (!driver) return;
    post({ type: "theme", css: stylingCssVars(driver.styling) });
    post({
        type: "init",
        settings: driver.settings ?? undefined,
        editable: false,
    });
    await reportSelection(await selectedIds());
}

async function saveSettings(settings: Record<string, unknown>): Promise<void> {
    if (!driver) return;
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
}

async function handleWebviewMessage(message: WebviewToDriver): Promise<void> {
    if (!driver) return;
    switch (message.type) {
        case "ready": {
            await enqueue(onReady);
            return;
        }
        case "settings": {
            const settings = message.settings;
            if (typeof settings !== "object" || settings === null) return;
            await enqueue(() => saveSettings(settings));
            return;
        }
        case "place": {
            await enqueue(() => place(message.spec, message.image));
            return;
        }
        case "edit": {
            await enqueue(startEdit);
            return;
        }
        case "update": {
            await enqueue(() => update(message.spec, message.image));
            return;
        }
        case "stop-edit": {
            driver.editing = null;
            return;
        }
        case "undo":
        case "redo": {
            const step = message.type;
            await enqueue(() => history(step));
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

async function readElements(
    properties: SubscribeableKey[],
    ids?: string[]
): Promise<SubscribedDrawdyElement[]> {
    if (!driver) return [];
    if (ids && ids.length === 0) return [];
    const res = await driver.issueCommand({
        type: "command:scene:get-drawdy-elements",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
        req: ids ? { properties, drawdyElementIds: ids } : { properties },
    });
    if (denied(res)) throw new PermissionDenied();
    if (res.res.error !== undefined) return [];
    return res.res.value.drawdyElements;
}

async function selectedIds(): Promise<string[]> {
    if (!driver) return [];
    const res = await driver.issueCommand({
        type: "command:scene:get-current-selected-drawdy-elements",
        driverId: driver.manifest.driverId,
        requestId: nextRequestId(),
    });
    if (denied(res)) throw new PermissionDenied();
    if (res.res.error !== undefined) return [];
    return res.res.value.drawdyElementIds;
}

async function reportSelection(ids: string[]): Promise<void> {
    if (!driver) return;
    const check = ++selectionCheck;
    const editable =
        ids.length > 0 &&
        (await readElements(["meta"], ids)).some((e) => ownMeta(e.meta));
    if (!driver || check !== selectionCheck) return;
    post({ type: "selection", editable });
}

export function bounds(
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

/** The code's parts as they are on the board right now, found by its group when it has one. */
async function membersOf(
    ids: string[],
    groupId: string | null
): Promise<SubscribedDrawdyElement[]> {
    const pool = groupId
        ? (await readElements(["groupId", "meta"])).filter(
              (e) => e.groupId === groupId && ownMeta(e.meta)
          )
        : (await readElements(["meta"], ids)).filter((e) => ownMeta(e.meta));
    return readElements(
        MEMBER_KEYS,
        pool.map((e) => e.id)
    );
}

async function startEdit(): Promise<void> {
    if (!driver) return;
    const ours = (
        await readElements(["groupId", "meta"], await selectedIds())
    ).filter((e) => ownMeta(e.meta));
    if (ours.length === 0) {
        post({
            type: "error",
            message: "Select a QR code you made with this extension first.",
        });
        return;
    }
    const groupId = ours.find((e) => e.groupId)?.groupId ?? null;
    const members = await membersOf(
        ours.map((e) => e.id),
        groupId
    );
    const head = members.find(isHead);
    const own = head ? ownMeta(head.meta) : null;
    const box = head ? bounds(head) : null;
    if (!driver) return;
    if (!head || !own || !box) {
        post({
            type: "error",
            message:
                "This QR code has lost its settings, so it cannot be edited. Make a new one instead.",
        });
        return;
    }
    const spec = normalizeSpec(own.spec ?? own.params);
    if (Math.abs(box.width - spec.size) > 1) {
        spec.size = clampSize(box.width);
    }
    driver.editing = {
        ids: members.map((e) => e.id),
        groupId,
        width: box.width,
    };
    post({ type: "load", spec });
}

const clampSize = (width: number): number =>
    Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, width)));

type Built =
    | { ok: true; elements: DrawdyElementSchema[]; height: number }
    | { ok: false; message: string };

type Keep = {
    groupId?: string;
    frameId?: string;
    layer?: number;
    opacity?: number;
};

function buildImage(
    spec: QrSpec,
    image: PngImage | undefined,
    x: number,
    y: number,
    keep: Keep
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
    const height = spec.size * (image.pixelHeight / image.pixelWidth);
    return {
        ok: true,
        height,
        elements: [
            {
                type: "image",
                drawdyElementId: driver.generateId(),
                url: image.dataUrl,
                x,
                y,
                width: spec.size,
                height,
                ...keep,
                meta: {
                    [driver.manifest.driverId]: { v: 1, params: spec },
                },
            },
        ],
    };
}

function build(
    spec: QrSpec,
    image: PngImage | undefined,
    x: number,
    y: number,
    keep: Keep = {}
): Built {
    if (!driver) return { ok: false, message: "" };
    if (spec.output === "image") return buildImage(spec, image, x, y, keep);
    const payload = buildPayload(spec.content, spec.fields);
    if (!payload.ok) return { ok: false, message: payload.message };
    const matrix = encodeMatrix(payload.payload, spec.ecc);
    if (!matrix) return { ok: false, message: TOO_LONG_MESSAGE };
    const count = elementCount(matrix, spec.style);
    if (count > MAX_ELEMENTS) {
        return { ok: false, message: tooManyShapesMessage(count) };
    }
    const { groupId, ...style } = keep;
    const elements = buildElements({
        matrix,
        spec,
        x,
        y,
        driverId: driver.manifest.driverId,
        nextId: driver.generateId,
        groupId,
    }).map((e) => ({ ...e, ...style }) as DrawdyElementSchema);
    return {
        ok: true,
        elements,
        height: spec.size + captionBlock(spec.caption, spec.size).height,
    };
}

type Added = { ok: true } | { ok: false; error: string };

async function addAll(elements: DrawdyElementSchema[]): Promise<Added> {
    if (!driver) return { ok: false, error: "" };
    const driverId = driver.manifest.driverId;
    const added = await driver.issueCommand({
        type: "command:scene:add-drawdy-elements",
        driverId,
        requestId: nextRequestId(),
        req: { elements },
    });
    if (denied(added)) throw new PermissionDenied();
    if (added.res.error !== undefined) {
        return { ok: false, error: "The board rejected that QR code." };
    }
    // Over its element limit the board adds nothing but still answers success.
    const back = await driver.issueCommand({
        type: "command:scene:element-rects",
        driverId,
        requestId: nextRequestId(),
        req: { drawdyElementIds: [elements[0].drawdyElementId] },
    });
    if (back.res.error === undefined && back.res.value.rects.length === 0) {
        return { ok: false, error: BOARD_FULL };
    }
    return { ok: true };
}

async function place(
    rawSpec: unknown,
    image: PngImage | undefined
): Promise<void> {
    if (!driver) return;
    const spec = normalizeSpec(rawSpec);
    const measured = build(spec, image, 0, 0);
    if (!measured.ok) {
        post({ type: "error", message: measured.message });
        return;
    }
    const area = await visibleArea(placeCtx());
    const centred = area
        ? centredIn(area, spec.size, measured.height)
        : { x: 0, y: 0, width: spec.size, height: measured.height };
    const rect = await findFreeRect(placeCtx(), {
        ...centred,
        x: Math.round(centred.x),
        y: Math.round(centred.y),
    });
    const built = build(spec, image, rect.x, rect.y);
    if (!driver || !built.ok) return;
    const added = await addAll(built.elements);
    if (!driver) return;
    if (!added.ok) {
        post({ type: "error", message: added.error });
        return;
    }
    const ids = built.elements.map((e) => e.drawdyElementId);
    await revealAndSelect(placeCtx(), ids, rect);
    post({ type: "placed", mode: "new", count: ids.length });
}

export function keptStyle(
    head: SubscribedDrawdyElement,
    members: SubscribedDrawdyElement[]
): Keep {
    const keep: Keep = {};
    if (typeof head.groupId === "string") keep.groupId = head.groupId;
    if (typeof head.frameId === "string") keep.frameId = head.frameId;
    if (typeof head.layer === "number") keep.layer = head.layer;
    const opacities = new Set(members.map((e) => e.opacity));
    const [shared] = opacities;
    if (opacities.size === 1 && typeof shared === "number") {
        keep.opacity = shared;
    }
    return keep;
}

async function update(
    rawSpec: unknown,
    image: PngImage | undefined
): Promise<void> {
    if (!driver) return;
    const editing = driver.editing;
    if (!editing) {
        post({
            type: "error",
            message: "Select a QR code and click Edit selected first.",
        });
        return;
    }
    const spec = normalizeSpec(rawSpec);
    const members = await membersOf(editing.ids, editing.groupId);
    const head = members.find(isHead);
    const box = head ? bounds(head) : null;
    if (!driver) return;
    if (!head || !box) {
        driver.editing = null;
        post({ type: "edit-ended" });
        post({
            type: "error",
            message:
                "The QR code you were editing is no longer on the board. Place it as a new code.",
        });
        return;
    }
    // A resize on the board after Edit selected wins over the size loaded into the panel then.
    if (Math.abs(box.width - editing.width) > 1) {
        spec.size = clampSize(box.width);
    }
    const built = build(spec, image, box.x, box.y, keptStyle(head, members));
    if (!built.ok) {
        post({ type: "error", message: built.message });
        return;
    }
    const driverId = driver.manifest.driverId;
    const removed = await driver.issueCommand({
        type: "command:scene:remove-drawdy-elements",
        driverId,
        requestId: nextRequestId(),
        req: { drawdyElementIds: members.map((e) => e.id) },
    });
    if (denied(removed)) throw new PermissionDenied();
    if (removed.res.error !== undefined) {
        post({
            type: "error",
            message: "The board would not replace that QR code.",
        });
        return;
    }
    const added = await addAll(built.elements);
    if (!driver) return;
    if (!added.ok) {
        await history("undo");
        post({
            type: "error",
            message:
                added.error === BOARD_FULL
                    ? BOARD_FULL
                    : "The board rejected the updated QR code, so the old one is back.",
        });
        return;
    }
    const ids = built.elements.map((e) => e.drawdyElementId);
    let undoSteps = 2;
    if (members.some((e) => e.locked === true)) {
        const locked = await driver.issueCommand({
            type: "command:scene:update-drawdy-elements",
            driverId,
            requestId: nextRequestId(),
            req: {
                updates: ids.map((id) => ({
                    drawdyElementId: id,
                    properties: { locked: true },
                })),
            },
        });
        if (locked.res.error === undefined) undoSteps = 3;
    }
    const groupId =
        spec.output === "shapes"
            ? ((built.elements[0] as { groupId?: string }).groupId ?? null)
            : (head.groupId ?? null);
    driver.editing = { ids, groupId, width: spec.size };
    const rect: Rect = {
        x: box.x,
        y: box.y,
        width: spec.size,
        height: built.height,
    };
    await revealAndSelect(placeCtx(), ids, rect);
    post({
        type: "placed",
        mode: "update",
        count: ids.length,
        undoSteps,
        rotationReset: members.some(
            (e) => typeof e.rotation === "number" && e.rotation !== 0
        ),
    });
}
