export const CONTENT_TYPES = [
    "url",
    "text",
    "wifi",
    "email",
    "phone",
    "sms",
    "contact",
    "location",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const ECC_LEVELS = ["L", "M", "Q", "H"] as const;
export type Ecc = (typeof ECC_LEVELS)[number];

export const MODULE_STYLES = ["square", "dots", "rounded"] as const;
export type ModuleStyle = (typeof MODULE_STYLES)[number];

export const OUTPUTS = ["shapes", "image"] as const;
export type Output = (typeof OUTPUTS)[number];

export const WIFI_SECURITIES = ["WPA", "WEP", "nopass"] as const;
export type WifiSecurity = (typeof WIFI_SECURITIES)[number];

export const QUIET_ZONES = [2, 3, 4] as const;

export const SIZE_MIN = 80;
export const SIZE_MAX = 1200;
export const CAPTION_MAX = 80;
const FIELD_MAX = 2000;

export type Fields = {
    url: string;
    text: string;
    ssid: string;
    password: string;
    security: WifiSecurity;
    hidden: boolean;
    emailTo: string;
    emailSubject: string;
    emailBody: string;
    phone: string;
    smsNumber: string;
    smsMessage: string;
    name: string;
    org: string;
    contactPhone: string;
    contactEmail: string;
    website: string;
    lat: string;
    lng: string;
};

export type Settings = {
    content: ContentType;
    ecc: Ecc;
    quiet: number;
    style: ModuleStyle;
    size: number;
    fg: string;
    bg: string;
    output: Output;
};

export type QrSpec = Settings & {
    caption: string;
    fields: Fields;
};

export const DEFAULT_FIELDS: Fields = {
    url: "",
    text: "",
    ssid: "",
    password: "",
    security: "WPA",
    hidden: false,
    emailTo: "",
    emailSubject: "",
    emailBody: "",
    phone: "",
    smsNumber: "",
    smsMessage: "",
    name: "",
    org: "",
    contactPhone: "",
    contactEmail: "",
    website: "",
    lat: "",
    lng: "",
};

export const DEFAULT_SETTINGS: Settings = {
    content: "url",
    ecc: "M",
    quiet: 4,
    style: "square",
    size: 240,
    fg: "#111827",
    bg: "#ffffff",
    output: "shapes",
};

export const DEFAULT_SPEC: QrSpec = {
    ...DEFAULT_SETTINGS,
    caption: "",
    fields: { ...DEFAULT_FIELDS },
};

const HEX = /^#[0-9a-f]{6}$/i;

const record = (raw: unknown): Record<string, unknown> =>
    raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

const oneOf = <T>(list: readonly T[], value: unknown, fallback: T): T =>
    list.includes(value as T) ? (value as T) : fallback;

const text = (value: unknown, fallback: string, max: number): string =>
    typeof value === "string" ? value.slice(0, max) : fallback;

export function normalizeSettings(raw: unknown): Settings {
    const r = record(raw);
    const d = DEFAULT_SETTINGS;
    const size = Number(r.size);
    return {
        content: oneOf(CONTENT_TYPES, r.content, d.content),
        ecc: oneOf(ECC_LEVELS, r.ecc, d.ecc),
        quiet: oneOf<number>(QUIET_ZONES, r.quiet, d.quiet),
        style: oneOf(MODULE_STYLES, r.style, d.style),
        size: Number.isFinite(size)
            ? Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, size)))
            : d.size,
        fg:
            typeof r.fg === "string" && HEX.test(r.fg)
                ? r.fg.toLowerCase()
                : d.fg,
        bg:
            typeof r.bg === "string" && HEX.test(r.bg)
                ? r.bg.toLowerCase()
                : d.bg,
        output: oneOf(OUTPUTS, r.output, d.output),
    };
}

export function normalizeFields(raw: unknown): Fields {
    const r = record(raw);
    const out: Record<string, unknown> = {};
    for (const [key, fallback] of Object.entries(DEFAULT_FIELDS)) {
        if (typeof fallback === "boolean") {
            out[key] = typeof r[key] === "boolean" ? r[key] : fallback;
        } else {
            out[key] = text(r[key], fallback as string, FIELD_MAX);
        }
    }
    out.security = oneOf(WIFI_SECURITIES, r.security, DEFAULT_FIELDS.security);
    return out as Fields;
}

export function normalizeSpec(raw: unknown): QrSpec {
    const r = record(raw);
    return {
        ...normalizeSettings(r),
        caption: text(r.caption, "", CAPTION_MAX),
        fields: normalizeFields(r.fields),
    };
}

export function settingsOf(spec: QrSpec): Settings {
    const { content, ecc, quiet, style, size, fg, bg, output } = spec;
    return { content, ecc, quiet, style, size, fg, bg, output };
}

function channel(value: number): number {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16);
    return (
        0.2126 * channel((n >> 16) & 0xff) +
        0.7152 * channel((n >> 8) & 0xff) +
        0.0722 * channel(n & 0xff)
    );
}

export function contrastRatio(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const MIN_CONTRAST = 4;

export type ContrastCheck =
    | { ok: true; ratio: number }
    | { ok: false; ratio: number; reason: "low" | "inverted" };

export function checkContrast(fg: string, bg: string): ContrastCheck {
    const ratio = contrastRatio(fg, bg);
    if (luminance(fg) > luminance(bg)) {
        return { ok: false, ratio, reason: "inverted" };
    }
    if (ratio < MIN_CONTRAST) return { ok: false, ratio, reason: "low" };
    return { ok: true, ratio };
}

export const CAPTION_INK = "#1f2937";

export function captionInk(bg: string): string {
    return contrastRatio(CAPTION_INK, bg) >= 4.5 ? CAPTION_INK : "#ffffff";
}
