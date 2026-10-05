import type { ContentType, Fields } from "./spec";

export type PayloadResult =
    | { ok: true; payload: string }
    | { ok: false; empty: boolean; message: string };

const empty = (message: string): PayloadResult => ({
    ok: false,
    empty: true,
    message,
});

const invalid = (message: string): PayloadResult => ({
    ok: false,
    empty: false,
    message,
});

const ok = (payload: string): PayloadResult => ({ ok: true, payload });

export function escapeWifi(value: string): string {
    return value.replace(/[\\;,:"]/g, (c) => `\\${c}`);
}

export function escapeVcard(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/\r\n|\r|\n/g, "\\n")
        .replace(/[,;]/g, (c) => `\\${c}`);
}

export function cleanPhone(value: string): string {
    return value.replace(/[\s().\- ]/g, "");
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function urlPayload(url: string): PayloadResult {
    const trimmed = url.trim();
    if (!trimmed) return empty("Type a link to make a code.");
    if (/\s/.test(trimmed)) return invalid("A link cannot contain spaces.");
    return ok(SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`);
}

export function textPayload(text: string): PayloadResult {
    if (!text.trim()) return empty("Type some text to make a code.");
    return ok(text);
}

export function wifiPayload(fields: Fields): PayloadResult {
    if (!fields.ssid) return empty("Type the network name to make a code.");
    const parts = [`T:${fields.security}`, `S:${escapeWifi(fields.ssid)}`];
    if (fields.security !== "nopass") {
        if (!fields.password) {
            return empty("Type the password, or set security to None.");
        }
        parts.push(`P:${escapeWifi(fields.password)}`);
    }
    if (fields.hidden) parts.push("H:true");
    return ok(`WIFI:${parts.join(";")};;`);
}

export function emailPayload(fields: Fields): PayloadResult {
    const to = fields.emailTo.trim();
    if (!to) return empty("Type an email address to make a code.");
    const address = encodeURIComponent(to)
        .replace(/%40/g, "@")
        .replace(/%2C/gi, ",");
    const query: string[] = [];
    if (fields.emailSubject) {
        query.push(`subject=${encodeURIComponent(fields.emailSubject)}`);
    }
    if (fields.emailBody) {
        const body = fields.emailBody.replace(/\r\n|\r|\n/g, "\r\n");
        query.push(`body=${encodeURIComponent(body)}`);
    }
    return ok(`mailto:${address}${query.length ? `?${query.join("&")}` : ""}`);
}

export function phonePayload(phone: string): PayloadResult {
    const number = cleanPhone(phone);
    if (!number) return empty("Type a phone number to make a code.");
    if (!/^\+?[0-9*#,;]+$/.test(number)) {
        return invalid("A phone number can only hold digits, + * and #.");
    }
    return ok(`tel:${number}`);
}

export function smsPayload(fields: Fields): PayloadResult {
    const number = cleanPhone(fields.smsNumber);
    if (!number) return empty("Type a phone number to make a code.");
    if (!/^\+?[0-9*#]+$/.test(number)) {
        return invalid("A phone number can only hold digits, + * and #.");
    }
    return ok(`SMSTO:${number}:${fields.smsMessage}`);
}

export function vcardPayload(fields: Fields): PayloadResult {
    const name = fields.name.trim();
    const org = fields.org.trim();
    const phone = cleanPhone(fields.contactPhone);
    const email = fields.contactEmail.trim();
    const website = fields.website.trim();
    if (!name && !org && !phone && !email && !website) {
        return empty("Type a name or another detail to make a contact code.");
    }
    const split = name.lastIndexOf(" ");
    const family = split > 0 ? name.slice(split + 1) : name;
    const given = split > 0 ? name.slice(0, split).trim() : "";
    const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${escapeVcard(family)};${escapeVcard(given)};;;`,
        `FN:${escapeVcard(name || org)}`,
    ];
    if (org) lines.push(`ORG:${escapeVcard(org)}`);
    if (phone) lines.push(`TEL:${phone}`);
    if (email) lines.push(`EMAIL:${email}`);
    if (website) lines.push(`URL:${website}`);
    lines.push("END:VCARD");
    return ok(lines.join("\r\n"));
}

const roundCoordinate = (value: number): string =>
    String(Math.round(value * 1e6) / 1e6);

export function locationPayload(fields: Fields): PayloadResult {
    const latText = fields.lat.trim();
    const lngText = fields.lng.trim();
    if (!latText || !lngText) {
        return empty("Type a latitude and a longitude to make a code.");
    }
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return invalid("Latitude must be a number from -90 to 90.");
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return invalid("Longitude must be a number from -180 to 180.");
    }
    return ok(`geo:${roundCoordinate(lat)},${roundCoordinate(lng)}`);
}

export function buildPayload(
    content: ContentType,
    fields: Fields
): PayloadResult {
    switch (content) {
        case "url":
            return urlPayload(fields.url);
        case "text":
            return textPayload(fields.text);
        case "wifi":
            return wifiPayload(fields);
        case "email":
            return emailPayload(fields);
        case "phone":
            return phonePayload(fields.phone);
        case "sms":
            return smsPayload(fields);
        case "contact":
            return vcardPayload(fields);
        case "location":
            return locationPayload(fields);
    }
}
