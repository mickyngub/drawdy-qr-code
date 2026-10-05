import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPayload } from "../src/shared/payload";
import { buildElements, encodeMatrix, spanModules } from "../src/shared/qr";
import {
    CONTENT_TYPES,
    DEFAULT_SPEC,
    ECC_LEVELS,
    MODULE_STYLES,
    type Fields,
    type QrSpec,
} from "../src/shared/spec";
import { decode, rasterize } from "./raster";

const FIELDS: Fields = {
    ...DEFAULT_SPEC.fields,
    url: "drawdy.io/board?id=42&view=grid",
    text: "Hello, board! สวัสดี 👋\nSecond line",
    ssid: "Cafe;Guest",
    password: 'p\\a;ss:"x",y',
    security: "WPA",
    hidden: true,
    emailTo: "hello@example.com",
    emailSubject: "Hi & welcome",
    emailBody: "Line one\nLine two",
    phone: "+1 (555) 010-9999",
    smsNumber: "+66 81 234 5678",
    smsMessage: "Meet at 5: room 3",
    name: "Ada Lovelace",
    org: "Analytical Engines, Ltd.",
    contactPhone: "+44 20 7946 0000",
    contactEmail: "ada@example.com",
    website: "https://example.com/ada",
    lat: "13.7563",
    lng: "100.5018",
};

function scan(spec: QrSpec, payload: string): string | null {
    const matrix = encodeMatrix(payload, spec.ecc);
    assert.ok(matrix);
    let n = 0;
    const elements = buildElements({
        matrix,
        spec,
        x: 37.5,
        y: -12.25,
        driverId: "mickyngub.qr-code",
        nextId: () => `id-${n++}`,
    });
    const unit = spec.size / spanModules(matrix, spec.quiet);
    return decode(rasterize(elements, 4 / unit));
}

for (const content of CONTENT_TYPES) {
    const result = buildPayload(content, FIELDS);
    assert.ok(result.ok, content);
    const payload = result.payload;
    for (const ecc of ECC_LEVELS) {
        test(`${content} at ${ecc} scans back to its payload`, () => {
            const spec = { ...DEFAULT_SPEC, content, ecc, fields: FIELDS };
            assert.equal(scan(spec, payload), payload);
        });
    }
}

for (const style of MODULE_STYLES) {
    for (const ecc of ECC_LEVELS) {
        test(`${style} modules at ${ecc} with a 2-module quiet zone and caption scan`, () => {
            const payload = "https://drawdy.io/b/6aa82094b5038212a84e5ea0";
            const spec: QrSpec = {
                ...DEFAULT_SPEC,
                style,
                ecc,
                quiet: 2,
                size: 320,
                fg: "#065f46",
                bg: "#fefce8",
                caption: "Scan to open the board",
            };
            assert.equal(scan(spec, payload), payload);
        });
    }
}
