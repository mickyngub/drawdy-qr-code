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
    normalizeSettings,
    normalizeSpec,
    settingsOf,
    SIZE_MAX,
    SIZE_MIN,
    type ContentType,
    type Ecc,
    type Fields,
    type ModuleStyle,
    type Output,
    type QrSpec,
    type WifiSecurity,
} from "../src/shared/spec";
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
];

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
        { key: "password", label: "Password" },
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

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;
const hintText = document.getElementById("hint-text") as HTMLSpanElement;
const readout = document.getElementById("readout") as HTMLDivElement;
const content = document.getElementById("content") as HTMLDivElement;
const statusLine = document.getElementById("status") as HTMLDivElement;
const primary = document.getElementById("primary") as HTMLButtonElement;
const secondary = document.getElementById("secondary") as HTMLButtonElement;

let spec: QrSpec = normalizeSpec(DEFAULT_SPEC);
let editing = false;
let editable = false;
let busy = false;
let settingsTimer = 0;
let capStatus = false;

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
    primary.textContent = editing ? "Update on board" : "Place on board";
    primary.disabled = busy || !canPlace();
    const showSecondary = editing || editable;
    secondary.textContent = editing ? "Stop editing" : "Edit selected";
    secondary.classList.toggle("ghost", !showSecondary);
    secondary.disabled = busy || !showSecondary;
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

function recompute(): void {
    const payload = buildPayload(spec.content, spec.fields);
    const matrix = payload.ok ? encodeMatrix(payload.payload, spec.ecc) : null;
    current = {
        payload,
        matrix,
        count: matrix ? elementCount(matrix, spec.style) : 0,
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
        drawPreview(canvas, matrix, spec, PREVIEW_BOX);
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
    paintContrast();
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

    const head = el("div", "section-head", content);
    const title = el("span", undefined, head);
    title.textContent = "Options";
    const reset = el("button", "link-btn", head);
    reset.type = "button";
    reset.textContent = "Reset options";
    reset.addEventListener("click", () => {
        spec = { ...spec, ...DEFAULT_SETTINGS, content: spec.content };
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

function submit(): void {
    if (busy || !canPlace() || !current.matrix) return;
    let image: PngImage | undefined;
    if (spec.output === "image") {
        const png = renderPng(current.matrix, spec);
        if (!png) {
            setStatus("The image could not be made.", "bad");
            return;
        }
        image = png;
    }
    busy = true;
    paintFooter();
    setStatus(editing ? "Updating…" : "Placing…");
    send(
        editing
            ? { type: "update", spec, image }
            : { type: "place", spec, image }
    );
}

function wire(): void {
    primary.addEventListener("click", submit);
    secondary.addEventListener("click", () => {
        if (busy) return;
        if (editing) {
            editing = false;
            send({ type: "stop-edit" });
            setStatus("");
            paintFooter();
            return;
        }
        setStatus("Loading the selected code…");
        send({ type: "edit" });
    });
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        send({ type: "close" });
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
            spec = normalizeSpec(message.spec);
            editing = true;
            pushControls();
            recompute();
            setStatus(
                "Editing the selected code. Change it, then click Update on board."
            );
            return;
        }
        case "placed": {
            busy = false;
            setStatus(
                message.updated
                    ? "Updated on the board."
                    : "Placed on the board.",
                "good"
            );
            paintFooter();
            return;
        }
        case "error": {
            busy = false;
            setStatus(message.message, "bad");
            paintFooter();
            return;
        }
    }
}

buildContent();
wire();
pushControls();
recompute();

api.onMessage((raw) => {
    if (!raw || typeof raw !== "object") return;
    handle(raw as DriverToWebview);
});

send({ type: "ready" });
