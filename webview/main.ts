import type {
    DriverToWebview,
    PngImage,
    WebviewToDriver,
} from "../src/shared/messages";
import { buildPayload, type PayloadResult } from "../src/shared/payload";
import {
    elementCount,
    encodeMatrix,
    MAX_ELEMENTS,
    TOO_LONG_MESSAGE,
    tooManyShapesMessage,
    type Matrix,
} from "../src/shared/qr";
import {
    CAPTION_MAX,
    checkContrast,
    DEFAULT_SETTINGS,
    DEFAULT_SPEC,
    hasLogo,
    normalizeSettings,
    normalizeSpec,
    settingsOf,
    SIZE_MAX,
    SIZE_MIN,
    type ContentType,
    type Ecc,
    type Fields,
    type Logo,
    type ModuleStyle,
    type Output,
    type QrSpec,
    type WifiSecurity,
} from "../src/shared/spec";
import { isField, keyAction } from "./lib/keys";
import {
    DRAWDY_LOGO_URL,
    loadedLogo,
    logoPng,
    logoSource,
    readPicture,
} from "./logos";
import { drawPreview, pngSize, renderPng } from "./render";
import {
    el,
    makeCheck,
    makeColourRow,
    makeRule,
    makeSegmented,
    makeSlider,
    makeText,
    type CheckControl,
    type ColourControl,
    type SegmentedControl,
    type SliderControl,
    type TextControl,
} from "./ui";

type DrawdyWebviewApi = {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    onMessage(listener: (message: unknown) => void): () => void;
};

declare function acquireDrawdyApi(): DrawdyWebviewApi;

const SETTINGS_DEBOUNCE_MS = 400;
const REPLY_TIMEOUT_MS = 20000;
const PREVIEW_BOX = { width: 200, height: 164 };

const CONTENT_LABELS: [ContentType, string][] = [
    ["url", "Link"],
    ["text", "Text"],
    ["wifi", "Wi-Fi"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["sms", "SMS"],
    ["contact", "Contact"],
    ["location", "Location"],
];

const ECC_OPTIONS: [Ecc, string, string][] = [
    ["L", "L 7%", "Low: survives about 7% damage"],
    ["M", "M 15%", "Medium: survives about 15% damage"],
    ["Q", "Q 25%", "Quartile: survives about 25% damage"],
    ["H", "H 30%", "High: survives about 30% damage"],
];

const FOREGROUNDS: [string, string][] = [
    ["#111827", "Ink"],
    ["#1e3a8a", "Navy"],
    ["#065f46", "Green"],
    ["#7c2d12", "Brown"],
    ["#581c87", "Purple"],
];

const BACKGROUNDS: [string, string][] = [
    ["#ffffff", "White"],
    ["#fefce8", "Cream"],
    ["#ecfdf5", "Mint"],
    ["#eff6ff", "Sky"],
    ["#c5f601", "Lime"],
];

const LOGO_OPTIONS: [Logo, string][] = [
    ["none", "None"],
    ["drawdy", "Drawdy logo"],
    ["custom", "Your picture"],
];

type Look = {
    name: string;
    title: string;
    style: ModuleStyle;
    fg: string;
    bg: string;
    logo?: Logo;
};

const LOOKS: Look[] = [
    {
        name: "Classic",
        title: "Square ink modules on white",
        style: "square",
        fg: "#111827",
        bg: "#ffffff",
    },
    {
        name: "Drawdy",
        title: "Rounded ink on lime with the Drawdy logo",
        style: "rounded",
        fg: "#111827",
        bg: "#c5f601",
        logo: "drawdy",
    },
    {
        name: "Navy dots",
        title: "Navy dots on sky blue",
        style: "dots",
        fg: "#1e3a8a",
        bg: "#eff6ff",
    },
    {
        name: "Mint",
        title: "Rounded green on mint",
        style: "rounded",
        fg: "#065f46",
        bg: "#ecfdf5",
    },
    {
        name: "Cream",
        title: "Brown dots on cream",
        style: "dots",
        fg: "#7c2d12",
        bg: "#fefce8",
    },
    {
        name: "Violet",
        title: "Rounded purple on white",
        style: "rounded",
        fg: "#581c87",
        bg: "#ffffff",
    },
];

const THUMB_BOX = { width: 52, height: 52 };
const SAMPLE = encodeMatrix("https://drawdy.io", "H");
const PICTURE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

type TextField = Exclude<keyof Fields, "security" | "hidden">;

type FieldDef = {
    key: TextField;
    label: string;
    multiline?: boolean;
    type?: string;
    placeholder?: string;
    inputMode?: string;
};

const GROUPS: Record<ContentType, (FieldDef | "security" | "hidden")[]> = {
    url: [
        {
            key: "url",
            label: "Link",
            type: "url",
            placeholder: "https://example.com",
        },
    ],
    text: [
        {
            key: "text",
            label: "Text",
            multiline: true,
            placeholder: "Anything you want people to read",
        },
    ],
    wifi: [
        { key: "ssid", label: "Network name", placeholder: "Office guest" },
        "security",
        { key: "password", label: "Password", type: "password" },
        "hidden",
    ],
    email: [
        {
            key: "emailTo",
            label: "To",
            type: "email",
            placeholder: "name@example.com",
        },
        { key: "emailSubject", label: "Subject" },
        { key: "emailBody", label: "Message", multiline: true },
    ],
    phone: [
        {
            key: "phone",
            label: "Phone number",
            type: "tel",
            placeholder: "+1 555 010 9999",
        },
    ],
    sms: [
        {
            key: "smsNumber",
            label: "Phone number",
            type: "tel",
            placeholder: "+1 555 010 9999",
        },
        { key: "smsMessage", label: "Message", multiline: true },
    ],
    contact: [
        { key: "name", label: "Name", placeholder: "Ada Lovelace" },
        { key: "org", label: "Organisation" },
        { key: "contactPhone", label: "Phone", type: "tel" },
        { key: "contactEmail", label: "Email", type: "email" },
        {
            key: "website",
            label: "Website",
            type: "url",
            placeholder: "https://example.com",
        },
    ],
    location: [
        {
            key: "lat",
            label: "Latitude",
            placeholder: "13.7563",
            inputMode: "decimal",
        },
        {
            key: "lng",
            label: "Longitude",
            placeholder: "100.5018",
            inputMode: "decimal",
        },
    ],
};

const api = acquireDrawdyApi();

const stage = document.getElementById("stage") as HTMLDivElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;
const hintText = document.getElementById("hint-text") as HTMLSpanElement;
const readout = document.getElementById("readout") as HTMLDivElement;
const content = document.getElementById("content") as HTMLDivElement;
const statusLine = document.getElementById("status") as HTMLDivElement;
const placeButton = document.getElementById("place") as HTMLButtonElement;
const updateButton = document.getElementById("update") as HTMLButtonElement;
const editButton = document.getElementById("edit") as HTMLButtonElement;
const banner = document.getElementById("edit-banner") as HTMLDivElement;
const stopEditButton = document.getElementById("stop-edit") as HTMLButtonElement;

let spec: QrSpec = normalizeSpec(DEFAULT_SPEC);
let editing = false;
let editable = false;
let busy = false;
let busyTimer = 0;
let settingsTimer = 0;
let capStatus = false;
let eccBeforeLogo: Ecc | null = null;

const fileInput = el("input", undefined, document.body);
fileInput.type = "file";
fileInput.accept = PICTURE_TYPES;
fileInput.hidden = true;

let current: {
    payload: PayloadResult;
    matrix: Matrix | null;
    count: number;
} = {
    payload: buildPayload(spec.content, spec.fields),
    matrix: null,
    count: 0,
};

const controls: {
    content: SegmentedControl<ContentType> | null;
    groups: Partial<Record<ContentType, HTMLDivElement>>;
    texts: Partial<Record<TextField, TextControl>>;
    security: SegmentedControl<WifiSecurity> | null;
    hidden: CheckControl | null;
    payload: TextControl | null;
    ecc: SegmentedControl<Ecc> | null;
    quiet: SegmentedControl<number> | null;
    style: SegmentedControl<ModuleStyle> | null;
    size: SliderControl | null;
    fg: ColourControl | null;
    bg: ColourControl | null;
    contrast: HTMLDivElement | null;
    caption: TextControl | null;
    output: SegmentedControl<Output> | null;
    logo: SegmentedControl<Logo> | null;
    logoNote: HTMLDivElement | null;
    looks: { look: Look; button: HTMLButtonElement; thumb: HTMLCanvasElement }[];
} = {
    content: null,
    groups: {},
    texts: {},
    security: null,
    hidden: null,
    payload: null,
    ecc: null,
    quiet: null,
    style: null,
    size: null,
    fg: null,
    bg: null,
    contrast: null,
    caption: null,
    output: null,
    logo: null,
    logoNote: null,
    looks: [],
};

function send(message: WebviewToDriver): void {
    api.postMessage(message);
}

function queueSettings(): void {
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
        settingsTimer = 0;
        send({
            type: "settings",
            settings: settingsOf(spec) as unknown as Record<string, unknown>,
        });
    }, SETTINGS_DEBOUNCE_MS) as unknown as number;
}

function setStatus(text: string, tone: "" | "good" | "bad" = ""): void {
    statusLine.textContent = text;
    statusLine.className = `status${tone ? ` ${tone}` : ""}`;
    capStatus = false;
}

function setHint(text: string | null, bad = false): void {
    if (text === null) {
        hint.hidden = true;
        return;
    }
    hintText.textContent = text;
    hint.className = bad ? "hint bad" : "hint";
    hint.hidden = false;
}

function overCap(): boolean {
    return spec.output === "shapes" && current.count > MAX_ELEMENTS;
}

function canPlace(): boolean {
    return current.matrix !== null && !overCap();
}

function paintFooter(): void {
    placeButton.textContent = editing ? "Place as new" : "Place on board";
    placeButton.classList.toggle("primary", !editing);
    placeButton.disabled = busy || !canPlace();
    updateButton.hidden = !editing;
    updateButton.disabled = busy || !canPlace();
    editButton.hidden = !editable;
    editButton.disabled = busy;
    banner.hidden = !editing;
}

function setBusy(next: boolean): void {
    busy = next;
    if (busyTimer) clearTimeout(busyTimer);
    busyTimer = 0;
    if (next) {
        busyTimer = setTimeout(() => {
            busyTimer = 0;
            busy = false;
            setStatus("Drawdy didn't answer. Try again.", "bad");
            paintFooter();
        }, REPLY_TIMEOUT_MS) as unknown as number;
    }
    paintFooter();
}

function setEditing(next: boolean): void {
    editing = next;
    paintFooter();
}

function paintContrast(): void {
    const note = controls.contrast;
    if (!note) return;
    const check = checkContrast(spec.fg, spec.bg);
    const ratio = `${(Math.round(check.ratio * 10) / 10).toFixed(1)}:1`;
    if (check.ok) {
        note.textContent = `Contrast ${ratio}. Phones will read this well.`;
        note.className = "note";
        return;
    }
    note.className = "note bad";
    note.textContent =
        check.reason === "inverted"
            ? `The code is lighter than its background (${ratio}). Many phones cannot scan that. Use a dark code on a light background.`
            : `Contrast is ${ratio}. Phones may not scan this. Aim for 4:1 or more.`;
}

function pictureImage(): HTMLImageElement | null {
    const src = logoSource(spec);
    return src ? loadedLogo(src, onPictureLoaded) : null;
}

function onPictureLoaded(): void {
    if (current.matrix && !canvas.hidden) {
        drawPreview(canvas, current.matrix, spec, PREVIEW_BOX, pictureImage());
    }
    paintLooks();
}

function lookSpec(look: Look): QrSpec {
    return {
        ...spec,
        style: look.style,
        fg: look.fg,
        bg: look.bg,
        logo: look.logo ?? spec.logo,
        quiet: 2,
        caption: "",
    };
}

function paintLooks(): void {
    for (const { look, button, thumb } of controls.looks) {
        const shown = lookSpec(look);
        if (SAMPLE) {
            const src = logoSource(shown);
            const picture = src ? loadedLogo(src, onPictureLoaded) : null;
            drawPreview(thumb, SAMPLE, shown, THUMB_BOX, picture);
        }
        const on =
            look.style === spec.style &&
            look.fg === spec.fg &&
            look.bg === spec.bg &&
            (!look.logo || look.logo === spec.logo);
        button.classList.toggle("on", on);
        button.setAttribute("aria-pressed", String(on));
    }
}

function paintPicture(): void {
    const on = hasLogo(spec);
    controls.logo?.set(spec.logo);
    controls.ecc?.set(spec.ecc);
    controls.ecc?.setDisabled(on ? ["L", "M", "Q"] : []);
    if (controls.logoNote) controls.logoNote.hidden = !on;
}

// A picture needs H; the level from before comes back when it is removed.
function pictureChange(logo: Logo): Partial<QrSpec> {
    if (logo === spec.logo) return {};
    if (logo === "none") {
        const ecc = eccBeforeLogo ?? spec.ecc;
        eccBeforeLogo = null;
        return { logo, ecc };
    }
    if (!hasLogo(spec)) eccBeforeLogo = spec.ecc;
    return { logo, ecc: "H" };
}

function setPicture(logo: Logo): void {
    commit(pictureChange(logo));
    paintPicture();
}

function applyLook(look: Look): void {
    commit({
        style: look.style,
        fg: look.fg,
        bg: look.bg,
        ...pictureChange(look.logo ?? spec.logo),
    });
    pushControls();
}

async function usePicture(file: File): Promise<void> {
    const picture = await readPicture(file);
    if (!picture) {
        setStatus(
            "That file is not a picture the panel can read. Try a PNG, JPG or SVG under 10 MB.",
            "bad"
        );
        return;
    }
    spec = { ...spec, logoImage: picture };
    setPicture("custom");
    setStatus("Your picture is in the middle of the code.", "good");
}

function recompute(): void {
    const payload = buildPayload(spec.content, spec.fields);
    const matrix = payload.ok ? encodeMatrix(payload.payload, spec.ecc) : null;
    current = {
        payload,
        matrix,
        count: matrix ? elementCount(matrix, spec) : 0,
    };
    controls.payload?.set(payload.ok ? payload.payload : "");

    if (!payload.ok) {
        canvas.hidden = true;
        setHint(payload.message, !payload.empty);
        readout.textContent = "";
    } else if (!matrix) {
        canvas.hidden = true;
        setHint(TOO_LONG_MESSAGE, true);
        readout.textContent = "";
    } else {
        setHint(null);
        canvas.hidden = false;
        drawPreview(canvas, matrix, spec, PREVIEW_BOX, pictureImage());
        const grid = `Version ${matrix.version} · ${matrix.size} × ${matrix.size} modules`;
        if (spec.output === "image") {
            const px = pngSize(matrix, spec);
            readout.textContent = `${grid} · ${px.width} × ${px.height} px PNG`;
        } else {
            readout.textContent = `${grid} · ${current.count.toLocaleString("en-US")} shapes`;
        }
    }

    if (matrix && overCap()) {
        setStatus(tooManyShapesMessage(current.count), "bad");
        capStatus = true;
    } else if (capStatus) {
        setStatus("");
    }
    paintFooter();
}

function commit(next: Partial<QrSpec>, persist = true): void {
    spec = { ...spec, ...next };
    paintContrast();
    recompute();
    paintLooks();
    if (persist) queueSettings();
}

function setField<K extends keyof Fields>(key: K, value: Fields[K]): void {
    spec = { ...spec, fields: { ...spec.fields, [key]: value } };
    if (key === "security") paintSecurity();
    recompute();
}

function paintSecurity(): void {
    const password = controls.texts.password;
    if (!password) return;
    const none = spec.fields.security === "nopass";
    password.input.disabled = none;
    password.wrap.classList.toggle("dim", none);
}

function showGroup(): void {
    for (const [type, group] of Object.entries(controls.groups)) {
        if (group) group.hidden = type !== spec.content;
    }
}

function pushControls(): void {
    controls.content?.set(spec.content);
    showGroup();
    for (const [key, control] of Object.entries(controls.texts)) {
        control?.set(String(spec.fields[key as TextField]));
    }
    controls.security?.set(spec.fields.security);
    controls.hidden?.set(spec.fields.hidden);
    paintSecurity();
    controls.ecc?.set(spec.ecc);
    controls.quiet?.set(spec.quiet);
    controls.style?.set(spec.style);
    controls.size?.set(spec.size);
    controls.fg?.set(spec.fg);
    controls.bg?.set(spec.bg);
    controls.caption?.set(spec.caption);
    controls.output?.set(spec.output);
    paintPicture();
    paintContrast();
    paintLooks();
}

function buildContent(): void {
    controls.content = makeSegmented<ContentType>(
        content,
        "Content",
        CONTENT_LABELS,
        spec.content,
        (type) => {
            commit({ content: type });
            showGroup();
        },
        true
    );

    const groups = el("div", "group", content);
    for (const [type] of CONTENT_LABELS) {
        const group = el("div", "group", groups);
        controls.groups[type] = group;
        for (const def of GROUPS[type]) {
            if (def === "security") {
                controls.security = makeSegmented<WifiSecurity>(
                    group,
                    "Security",
                    [
                        ["WPA", "WPA/WPA2/WPA3"],
                        ["WEP", "WEP"],
                        ["nopass", "None"],
                    ],
                    spec.fields.security,
                    (security) => setField("security", security)
                );
                continue;
            }
            if (def === "hidden") {
                controls.hidden = makeCheck(group, "Hidden network", (hidden) =>
                    setField("hidden", hidden)
                );
                continue;
            }
            controls.texts[def.key] = makeText(
                group,
                def.label,
                {
                    multiline: def.multiline,
                    type: def.type,
                    placeholder: def.placeholder,
                    inputMode: def.inputMode,
                },
                (value) => setField(def.key, value)
            );
        }
    }

    controls.payload = makeText(content, "Payload (what the code holds)", {
        multiline: true,
        rows: 2,
        readOnly: true,
        className: "payload",
    });

    makeRule(content);
    buildLook();
    makeRule(content);

    const head = el("div", "section-head", content);
    const title = el("span", undefined, head);
    title.textContent = "Options";
    const reset = el("button", "link-btn", head);
    reset.type = "button";
    reset.textContent = "Reset options";
    reset.addEventListener("click", () => {
        spec = {
            ...spec,
            ...DEFAULT_SETTINGS,
            content: spec.content,
            logoImage: spec.logoImage,
        };
        eccBeforeLogo = null;
        pushControls();
        recompute();
        queueSettings();
    });

    controls.ecc = makeSegmented<Ecc>(
        content,
        "Error correction",
        ECC_OPTIONS,
        spec.ecc,
        (ecc) => commit({ ecc })
    );
    controls.quiet = makeSegmented<number>(
        content,
        "Quiet zone",
        [
            [2, "2 modules"],
            [3, "3"],
            [4, "4"],
        ],
        spec.quiet,
        (quiet) => commit({ quiet })
    );
    controls.style = makeSegmented<ModuleStyle>(
        content,
        "Modules",
        [
            ["square", "Square"],
            ["dots", "Dots"],
            ["rounded", "Rounded"],
        ],
        spec.style,
        (style) => commit({ style })
    );
    controls.size = makeSlider(
        content,
        { label: "Size on the board", min: SIZE_MIN, max: SIZE_MAX, step: 10 },
        spec.size,
        (size) => commit({ size })
    );
    controls.fg = makeColourRow(
        content,
        "Code colour",
        FOREGROUNDS,
        spec.fg,
        (fg) => commit({ fg })
    );
    controls.bg = makeColourRow(
        content,
        "Background",
        BACKGROUNDS,
        spec.bg,
        (bg) => commit({ bg })
    );
    controls.contrast = el("div", "note", content);
    controls.contrast.setAttribute("aria-live", "polite");
    controls.caption = makeText(
        content,
        "Caption",
        {
            placeholder: "Optional, shown under the code",
            maxLength: CAPTION_MAX,
        },
        (caption) => commit({ caption }, false)
    );
    controls.output = makeSegmented<Output>(
        content,
        "Place as",
        [
            ["shapes", "Shapes you can recolour"],
            ["image", "PNG image"],
        ],
        spec.output,
        (output) => commit({ output })
    );
}

function buildLook(): void {
    const head = el("div", "section-head", content);
    const title = el("span", undefined, head);
    title.textContent = "Look";

    controls.logo = makeSegmented<Logo>(
        content,
        "Picture in the middle",
        LOGO_OPTIONS,
        spec.logo,
        (logo) => {
            if (logo === "custom" && !spec.logoImage) {
                controls.logo?.set(spec.logo);
                fileInput.click();
                return;
            }
            setPicture(logo);
        }
    );
    const upload = el("button", "link-btn", controls.logo.head);
    upload.type = "button";
    upload.textContent = "Upload…";
    upload.title = "Pick a PNG, JPG, WebP, GIF or SVG, or drop one on the preview";
    upload.addEventListener("click", () => fileInput.click());
    controls.logoNote = el("div", "note", content);
    controls.logoNote.textContent =
        "Error correction stays at H while a picture covers the middle, so the code still scans.";
    controls.logoNote.hidden = true;

    const field = el("div", "field", content);
    const fieldHead = el("div", "field-head", field);
    const label = el("span", "label", fieldHead);
    label.textContent = "Presets";
    const grid = el("div", "looks", field);
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", "Presets");
    controls.looks = LOOKS.map((look) => {
        const button = el("button", "look", grid);
        button.type = "button";
        button.title = look.title;
        const thumb = el("canvas", undefined, button);
        thumb.setAttribute("aria-hidden", "true");
        const name = el("span", undefined, button);
        name.textContent = look.name;
        button.addEventListener("click", () => applyLook(look));
        return { look, button, thumb };
    });
}

function submit(update: boolean): void {
    if (busy || !canPlace() || !current.matrix) return;
    if (update && !editing) return;
    const src = logoSource(spec);
    const picture = pictureImage();
    if (src && !picture) {
        setStatus("The picture is still loading. Try again in a moment.", "bad");
        return;
    }
    let image: PngImage | undefined;
    let logo: PngImage | undefined;
    if (spec.output === "image") {
        const png = renderPng(current.matrix, spec, picture);
        if (!png) {
            setStatus("The image could not be made.", "bad");
            return;
        }
        image = png;
    } else if (src && picture) {
        const png = logoPng(src, picture);
        if (!png) {
            setStatus("The picture could not be prepared.", "bad");
            return;
        }
        logo = png;
    }
    setBusy(true);
    setStatus(update ? "Updating…" : "Placing…");
    send(
        update
            ? { type: "update", spec, image, logo }
            : { type: "place", spec, image, logo }
    );
}

function addPasswordToggle(): void {
    const password = controls.texts.password;
    const head = password?.wrap.querySelector(".field-head");
    if (!password || !head) return;
    const toggle = el("button", "link-btn", head as HTMLElement);
    toggle.type = "button";
    toggle.textContent = "Show";
    toggle.setAttribute("aria-pressed", "false");
    toggle.setAttribute("aria-label", "Show the password");
    toggle.addEventListener("click", () => {
        const input = password.input as HTMLInputElement;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        toggle.textContent = show ? "Hide" : "Show";
        toggle.setAttribute("aria-pressed", String(show));
        toggle.setAttribute(
            "aria-label",
            show ? "Hide the password" : "Show the password"
        );
    });
}

function placedText(message: Extract<DriverToWebview, { type: "placed" }>): string {
    if (message.mode === "new") {
        return "Placed the QR code. Press ⌘Z or Ctrl+Z to undo.";
    }
    const times =
        message.undoSteps === 2 ? "twice" : `${message.undoSteps} times`;
    return `Updated the QR code${
        message.rotationReset ? " (rotation reset)" : ""
    }. Press ⌘Z or Ctrl+Z ${times} to get the old version back.`;
}

function wire(): void {
    placeButton.addEventListener("click", () => submit(false));
    updateButton.addEventListener("click", () => submit(true));
    editButton.addEventListener("click", () => {
        if (busy) return;
        setStatus("Reading the selected QR code…");
        send({ type: "edit" });
    });
    stopEditButton.addEventListener("click", () => {
        setEditing(false);
        send({ type: "stop-edit" });
        setStatus("Stopped editing. Place on board adds a new QR code.");
    });
    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (file) void usePicture(file);
    });
    // A file dropped anywhere else would navigate the panel to it.
    const carriesFiles = (event: DragEvent) =>
        event.dataTransfer?.types.includes("Files") === true;
    document.addEventListener("dragover", (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = stage.contains(event.target as Node)
                ? "copy"
                : "none";
        }
        stage.classList.toggle("drop", stage.contains(event.target as Node));
    });
    document.addEventListener("dragleave", (event) => {
        if (!stage.contains(event.relatedTarget as Node | null)) {
            stage.classList.remove("drop");
        }
    });
    document.addEventListener("drop", (event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        stage.classList.remove("drop");
        const file = event.dataTransfer?.files[0];
        if (file && stage.contains(event.target as Node)) void usePicture(file);
    });
    document.addEventListener("keydown", (event) => {
        const action = keyAction(event, isField(event.target));
        if (!action) return;
        event.preventDefault();
        if (action === "blur") (event.target as HTMLElement).blur();
        else send({ type: action });
    });
}

function handle(message: DriverToWebview): void {
    switch (message.type) {
        case "init": {
            spec = { ...spec, ...normalizeSettings(message.settings) };
            editable = message.editable === true;
            pushControls();
            recompute();
            return;
        }
        case "theme": {
            document.documentElement.style.cssText = message.css;
            return;
        }
        case "selection": {
            editable = message.editable === true;
            paintFooter();
            return;
        }
        case "load": {
            const upload = spec.logoImage;
            spec = normalizeSpec(message.spec);
            if (!spec.logoImage) spec.logoImage = upload;
            eccBeforeLogo = null;
            editing = true;
            pushControls();
            recompute();
            setStatus(
                "Loaded the selected QR code. Change it, then click Update on board."
            );
            return;
        }
        case "edit-ended": {
            setEditing(false);
            return;
        }
        case "placed": {
            setBusy(false);
            setStatus(placedText(message), "good");
            return;
        }
        case "error": {
            setBusy(false);
            setStatus(message.message, "bad");
            return;
        }
    }
}

loadedLogo(DRAWDY_LOGO_URL, onPictureLoaded);
buildContent();
addPasswordToggle();
wire();
pushControls();
recompute();

api.onMessage((raw) => {
    if (!raw || typeof raw !== "object") return;
    handle(raw as DriverToWebview);
});

send({ type: "ready" });
