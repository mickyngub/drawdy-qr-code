import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildElements,
    elementCount,
    encodeMatrix,
    logoBox,
    logoRect,
    moduleMarks,
    spanModules,
    withoutLogoArea,
    type Matrix,
} from "../src/shared/qr";
import {
    DEFAULT_SPEC,
    MODULE_STYLES,
    normalizeSettings,
    normalizeSpec,
    settingsOf,
    type QrSpec,
} from "../src/shared/spec";
import { decode, rasterize } from "./raster";

const DRIVER = "mickyngub.qr-code";
const PICTURE = "data:image/png;base64,iVBORw0KGgo=";

const counter = () => {
    let n = 0;
    return () => `id-${n++}`;
};

const encode = (payload: string): Matrix => {
    const matrix = encodeMatrix(payload, "H");
    assert.ok(matrix, `could not encode ${payload.length} characters`);
    return matrix;
};

const withLogo = (patch: Partial<QrSpec> = {}): QrSpec => ({
    ...DEFAULT_SPEC,
    ecc: "H",
    logo: "drawdy",
    ...patch,
});

// Lengths that land on versions 3, 6, 10, 17, 25, 34 and 40 at H.
const LENGTHS = [5, 30, 100, 250, 500, 900, 1250];

test("the picture square is odd, centred and about a quarter of the code at every version", () => {
    for (let version = 1; version <= 40; version++) {
        const size = 17 + version * 4;
        const box = logoBox({ version, size, modules: [] });
        assert.equal(box.span % 2, 1, `even span at version ${version}`);
        assert.equal(box.start * 2 + box.span, size);
        assert.ok(box.start > 7, `touches the finders at version ${version}`);
        const share = box.span / size;
        assert.ok(
            share >= 0.2 && share <= 0.25,
            `${share} at version ${version}`
        );
    }
    assert.deepEqual(logoBox({ version: 1, size: 21, modules: [] }), {
        start: 8,
        span: 5,
    });
});

test("no module is drawn under the picture, and the rest of the code is untouched", () => {
    const m = encode("https://drawdy.io");
    const cleared = withoutLogoArea(m);
    const { start, span } = logoBox(m);
    m.modules.forEach((row, y) =>
        row.forEach((dark, x) => {
            const inside =
                x >= start &&
                x < start + span &&
                y >= start &&
                y < start + span;
            assert.equal(cleared.modules[y][x], inside ? false : dark);
        })
    );
    for (const style of MODULE_STYLES) {
        const marks = moduleMarks(cleared, style);
        assert.ok(
            marks.every(
                (mark) =>
                    mark.x + mark.w <= start ||
                    mark.x >= start + span ||
                    mark.y + mark.h <= start ||
                    mark.y >= start + span
            ),
            `${style} draws under the picture`
        );
    }
});

test("the picture goes on last, inside the cleared square and the code's group", () => {
    const m = encode("https://drawdy.io");
    const spec = withLogo({ size: 300, quiet: 3 });
    const elements = buildElements({
        matrix: m,
        spec,
        x: 10,
        y: 20,
        driverId: DRIVER,
        nextId: counter(),
        logo: PICTURE,
    });
    assert.equal(elements.length, elementCount(m, spec));
    const picture = elements.at(-1)!;
    assert.equal(picture.type, "image");
    assert.equal((picture as { url: string }).url, PICTURE);
    assert.equal(picture.groupId, elements[0].groupId);
    assert.deepEqual(picture.meta, { [DRIVER]: { v: 1, part: true } });
    const unit = 300 / spanModules(m, 3);
    const rect = logoRect(m, 3);
    const box = logoBox(m);
    const p = picture as {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    assert.equal(p.width, p.height);
    assert.ok(Math.abs(p.width - rect.side * unit) < 1e-9);
    assert.ok(p.x > 10 + (3 + box.start) * unit);
    assert.ok(p.x + p.width < 10 + (3 + box.start + box.span) * unit);
    assert.ok(p.y > 20 + (3 + box.start) * unit);
    assert.equal(
        elements.filter((e) => e.type === "image").length,
        1,
        "one picture"
    );
    const none = buildElements({
        matrix: m,
        spec: { ...spec, logo: "none" },
        x: 0,
        y: 0,
        driverId: DRIVER,
        nextId: counter(),
        logo: PICTURE,
    });
    assert.ok(none.every((e) => e.type === "shape"));
});

// The board shows the picture as an image; a solid square in the code colour
// is the hardest picture a scanner can meet, so it stands in for one here.
function scan(
    spec: QrSpec,
    payload: string,
    pxPerModule: number,
    solid = false
): string | null {
    const matrix = encode(payload);
    const elements = buildElements({
        matrix,
        spec,
        x: 0,
        y: 0,
        driverId: DRIVER,
        nextId: counter(),
        logo: PICTURE,
    }).flatMap((e): DrawdyElementSchema[] => {
        if (e.type !== "image") return [e];
        if (!solid) return [];
        return [
            {
                type: "shape",
                componentType: "rect",
                drawdyElementId: e.drawdyElementId,
                x: e.x,
                y: e.y,
                width: e.width,
                height: e.height,
                strokeColor: spec.fg,
                fillColor: spec.fg,
                fillStyle: "solid",
                strokeWidth: 0,
                meta: {},
            },
        ];
    });
    const unit = spec.size / spanModules(matrix, spec.quiet);
    return decode(rasterize(elements, pxPerModule / unit));
}

// jsQR misses a few plain codes at some pixel densities, so each code is held
// to the same code without a picture, read at the same density.
for (const style of MODULE_STYLES) {
    for (const solid of [false, true]) {
        test(`${style} codes with ${solid ? "a solid" : "a see-through"} picture scan wherever the plain code does`, () => {
            let compared = 0;
            for (const length of LENGTHS) {
                const payload = `https://drawdy.io/${"q".repeat(length)}`;
                const plain = withLogo({
                    style,
                    quiet: 2,
                    size: 320,
                    logo: "none",
                });
                for (const px of [4, 6]) {
                    if (scan(plain, payload, px) !== payload) continue;
                    assert.equal(
                        scan({ ...plain, logo: "drawdy" }, payload, px, solid),
                        payload,
                        `${length} characters at ${px} px a module`
                    );
                    compared++;
                }
            }
            assert.ok(compared >= LENGTHS.length, `only ${compared} plain codes scanned`);
        });
    }
}

test("a picture forces error correction H and a lost upload falls back to none", () => {
    assert.equal(normalizeSettings({ logo: "drawdy", ecc: "L" }).ecc, "H");
    assert.equal(normalizeSettings({ logo: "none", ecc: "L" }).ecc, "L");
    const lost = normalizeSettings({ logo: "custom", ecc: "M" });
    assert.equal(lost.logo, "none");
    assert.equal(lost.ecc, "M");
    const kept = normalizeSettings({ logo: "custom", logoImage: PICTURE });
    assert.equal(kept.logo, "custom");
    assert.equal(kept.logoImage, PICTURE);
    assert.equal(normalizeSettings({ logo: "cat" }).logo, "none");
    for (const logoImage of [
        "data:image/jpeg;base64,/9j/",
        "https://example.com/logo.png",
        `data:image/png;base64,${"A".repeat(700_000)}`,
        42,
    ]) {
        assert.equal(
            normalizeSettings({ logo: "custom", logoImage }).logo,
            "none"
        );
    }
});

test("an upload stays in the settings while another picture is chosen", () => {
    const spec = normalizeSpec({ logo: "drawdy", logoImage: PICTURE });
    assert.equal(spec.logo, "drawdy");
    assert.equal(spec.logoImage, PICTURE);
    assert.deepEqual(settingsOf(spec).logoImage, PICTURE);
    assert.equal(settingsOf(spec).logo, "drawdy");
});

test("a code keeps an upload in its meta only when it shows it", () => {
    const m = encode("https://drawdy.io");
    const metaOf = (spec: QrSpec) =>
        (
            buildElements({
                matrix: m,
                spec,
                x: 0,
                y: 0,
                driverId: DRIVER,
                nextId: counter(),
                logo: PICTURE,
            })[0].meta?.[DRIVER] as { spec: QrSpec }
        ).spec;
    assert.equal(metaOf(withLogo({ logoImage: PICTURE })).logoImage, "");
    assert.equal(
        metaOf(withLogo({ logo: "custom", logoImage: PICTURE })).logoImage,
        PICTURE
    );
});
