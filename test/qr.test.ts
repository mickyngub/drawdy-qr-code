import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    batches,
    buildElements,
    captionBlock,
    elementCount,
    encodeMatrix,
    moduleMarks,
    pixelLayout,
    rowRuns,
    squareCells,
    type Matrix,
} from "../src/shared/qr";
import {
    checkContrast,
    DEFAULT_SPEC,
    ECC_LEVELS,
    normalizeSpec,
    type QrSpec,
} from "../src/shared/spec";

type Shape = Extract<DrawdyElementSchema, { type: "shape" }>;

const DRIVER = "mickyngub.qr-code";

const counter = () => {
    let n = 0;
    return () => `id-${n++}`;
};

const encode = (payload: string, ecc: QrSpec["ecc"] = "M"): Matrix => {
    const matrix = encodeMatrix(payload, ecc);
    assert.ok(matrix, `could not encode ${payload}`);
    return matrix;
};

const spec = (patch: Partial<QrSpec> = {}): QrSpec => ({
    ...DEFAULT_SPEC,
    ...patch,
});

const close = (actual: number, expected: number) =>
    assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `${actual} is not ${expected}`
    );

test("the encoder keeps the chosen level and picks the smallest version", () => {
    const m = encode("https://drawdy.io", "M");
    assert.equal(m.version, 2);
    assert.equal(m.size, 25);
    assert.equal(m.modules.length, 25);
    assert.ok(m.modules.every((row) => row.length === 25));
    assert.equal(encode("https://drawdy.io", "L").version, 1);
    assert.equal(encode("https://drawdy.io", "H").version, 3);
});

test("a payload too long for version 40 gives null", () => {
    assert.equal(encodeMatrix("x".repeat(3000), "H"), null);
    assert.ok(encodeMatrix("x".repeat(1200), "H"));
});

const PAYLOADS = ["https://drawdy.io", "WIFI:T:WPA;S:Lab;P:pw;;", "x".repeat(400)];

test("row runs rebuild the module matrix exactly and are maximal", () => {
    for (const payload of PAYLOADS) {
        for (const ecc of ECC_LEVELS) {
            const m = encode(payload, ecc);
            const runs = rowRuns(m.modules);
            const rebuilt = m.modules.map((row) => row.map(() => false));
            for (const run of runs) {
                assert.ok(run.length >= 1);
                for (let x = run.start; x < run.start + run.length; x++) {
                    assert.equal(rebuilt[run.row][x], false, "runs overlap");
                    rebuilt[run.row][x] = true;
                }
            }
            assert.deepEqual(rebuilt, m.modules);
            for (const run of runs) {
                const after = run.start + run.length;
                assert.equal(m.modules[run.row][after] ?? false, false);
                assert.equal(m.modules[run.row][run.start - 1] ?? false, false);
            }
        }
    }
});

test("square cells cover exactly the dark modules and leave no seam", () => {
    for (const payload of PAYLOADS) {
        for (const ecc of ECC_LEVELS) {
            const m = encode(payload, ecc);
            const cells = squareCells(m.modules);
            const covered = m.modules.map((row) => row.map(() => false));
            const owner = (x: number, y: number) =>
                cells.filter(
                    (c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h
                );
            for (const c of cells) {
                assert.ok(c.w === 1 || c.h === 1, "cells are runs");
                for (let y = c.y; y < c.y + c.h; y++) {
                    for (let x = c.x; x < c.x + c.w; x++) covered[y][x] = true;
                }
            }
            assert.deepEqual(covered, m.modules);
            m.modules.forEach((row, y) =>
                row.forEach((dark, x) => {
                    if (!dark) return;
                    for (const [nx, ny] of [
                        [x + 1, y],
                        [x, y + 1],
                    ]) {
                        if (!m.modules[ny]?.[nx]) continue;
                        const shared = owner(x, y).some((c) =>
                            owner(nx, ny).includes(c)
                        );
                        assert.ok(shared, `seam between ${x},${y} and ${nx},${ny}`);
                    }
                })
            );
        }
    }
});

test("a known payload makes a known number of shapes in each style", () => {
    const m = encode("https://drawdy.io", "M");
    assert.equal(rowRuns(m.modules).length, 165);
    assert.equal(squareCells(m.modules).length, 147);
    assert.equal(elementCount(m, "square"), 148);
    assert.equal(elementCount(m, "dots"), 233);
    assert.equal(elementCount(m, "rounded"), 233);
    const dark = m.modules.flat().filter(Boolean).length;
    const finderDark = 3 * (24 + 9);
    assert.equal(moduleMarks(m, "dots").length, 9 + dark - finderDark);
});

test("square output is a white card plus crisp runs inset by half the stroke", () => {
    const m = encode("https://drawdy.io", "M");
    const s = spec();
    const elements = buildElements({
        matrix: m,
        spec: s,
        x: 100,
        y: 50,
        driverId: DRIVER,
        nextId: counter(),
    }) as Shape[];
    assert.equal(elements.length, 148);
    const unit = 240 / 33;

    const [card, first, ...rest] = elements;
    assert.equal(card.type, "shape");
    assert.equal(card.componentType, "rect");
    assert.equal(card.x, 100);
    assert.equal(card.y, 50);
    assert.equal(card.width, 240);
    assert.equal(card.height, 240);
    assert.equal(card.fillColor, "#ffffff");
    assert.equal(card.strokeColor, "#ffffff");
    assert.equal(card.text, undefined);
    assert.deepEqual(card.meta, { [DRIVER]: { v: 1, spec: s } });

    close(first.x, 100 + 4 * unit + 0.5);
    close(first.y, 50 + 4 * unit + 0.5);
    close(first.width, 7 * unit - 1);
    close(first.height, unit - 1);
    assert.equal(first.fillColor, "#111827");
    assert.equal(first.strokeColor, "#111827");
    assert.equal(first.strokeWidth, 1);
    assert.equal(first.cornerRadius, 0);
    assert.equal(first.roughness, 0);
    assert.equal(first.fillStyle, "solid");
    assert.deepEqual(first.meta, { [DRIVER]: { v: 1, part: true } });

    const group = card.groupId;
    assert.ok(group);
    assert.ok(elements.every((e) => e.groupId === group));
    assert.ok(rest.every((e) => e.meta?.[DRIVER]?.part === true));
    const ids = new Set(elements.map((e) => e.drawdyElementId));
    assert.equal(ids.size, elements.length);
    assert.ok(!ids.has(group));

    const last = elements[elements.length - 1];
    assert.ok(last.x + last.width <= 100 + 240 - 4 * unit + 1e-9);
    assert.ok(last.y + last.height <= 50 + 240 - 4 * unit + 1e-9);
});

test("dots and rounded inset their marks and keep solid finder eyes", () => {
    const m = encode("https://drawdy.io", "M");
    const dots = buildElements({
        matrix: m,
        spec: spec({ style: "dots", quiet: 2, size: 270 }),
        x: 0,
        y: 0,
        driverId: DRIVER,
        nextId: counter(),
    }) as Shape[];
    const unit = 270 / 29;
    const [, outer, hole, eye] = dots;
    close(outer.x, 2 * unit + 0.5);
    close(outer.width, 7 * unit - 1);
    assert.equal(outer.fillColor, "#111827");
    assert.equal(hole.fillColor, "#ffffff");
    close(hole.x, 3 * unit + 0.5);
    assert.equal(eye.componentType, "circle");
    close(eye.width, 3 * unit - 1);
    const dot = dots[10];
    assert.equal(dot.componentType, "circle");
    close(dot.width, 0.84 * unit - 1);

    const rounded = buildElements({
        matrix: m,
        spec: spec({ style: "rounded" }),
        x: 0,
        y: 0,
        driverId: DRIVER,
        nextId: counter(),
    }) as Shape[];
    const cell = rounded[10];
    const u = 240 / 33;
    assert.equal(cell.componentType, "rect");
    close(cell.cornerRadius ?? -1, 0.3 * u - 0.5);
    close(cell.width, 0.9 * u - 1);
});

test("a caption grows the card and sits at its bottom in dark ink", () => {
    const m = encode("https://drawdy.io", "M");
    const caption = captionBlock("Scan me", 240);
    assert.deepEqual(caption, { fontSize: 17, lines: 1, height: 32 });
    assert.equal(captionBlock("Scan to join the Wi-Fi", 240).lines, 2);
    assert.equal(captionBlock("   ", 240).height, 0);
    const [card] = buildElements({
        matrix: m,
        spec: spec({ caption: " Scan me " }),
        x: 0,
        y: 0,
        driverId: DRIVER,
        nextId: counter(),
    }) as Shape[];
    assert.equal(card.height, 272);
    assert.equal(card.text, "Scan me");
    assert.equal(card.fontSize, 17);
    assert.equal(card.textColor, "#1f2937");
    assert.equal(card.textVerticalAlign, "bottom");
    const [dark] = buildElements({
        matrix: m,
        spec: spec({ caption: "x", fg: "#ffffff", bg: "#111827" }),
        x: 0,
        y: 0,
        driverId: DRIVER,
        nextId: counter(),
    }) as Shape[];
    assert.equal(dark.textColor, "#ffffff");
});

test("image output uses whole pixels per module within 2048 px", () => {
    for (const payload of ["a", "x".repeat(1200)]) {
        const m = encode(payload, "H");
        for (const quiet of [2, 4]) {
            const layout = pixelLayout(m, spec({ quiet }));
            assert.ok(
                Number.isInteger(layout.modulePx) && layout.modulePx >= 1
            );
            assert.equal(layout.codePx, (m.size + quiet * 2) * layout.modulePx);
            assert.ok(layout.codePx <= 2048);
        }
    }
    const small = pixelLayout(encode("a", "L"), spec());
    assert.deepEqual(small, { modulePx: 35, codePx: 1015, scale: 1015 / 240 });
});

test("large placements split into batches of at most 500", () => {
    const items = Array.from({ length: 1201 }, (_, i) => i);
    assert.deepEqual(
        batches(items).map((b) => b.length),
        [500, 500, 201]
    );
    assert.deepEqual(batches([]), []);
});

test("contrast warns below 4:1 and when the foreground is lighter", () => {
    const fine = checkContrast("#111827", "#ffffff");
    assert.equal(fine.ok, true);
    assert.equal(Math.round(fine.ratio * 10) / 10, 17.7);
    assert.deepEqual(
        { ...checkContrast("#9ca3af", "#ffffff"), ratio: 0 },
        { ok: false, reason: "low", ratio: 0 }
    );
    assert.equal(checkContrast("#ffffff", "#111827").ok, false);
    assert.equal(
        (checkContrast("#ffffff", "#111827") as { reason: string }).reason,
        "inverted"
    );
});

test("normalizeSpec falls back to defaults and clamps what it keeps", () => {
    assert.deepEqual(normalizeSpec(null), DEFAULT_SPEC);
    const s = normalizeSpec({
        content: "wifi",
        ecc: "Z",
        quiet: 7,
        style: "dots",
        size: 99999,
        fg: "#ABCDEF",
        bg: "red",
        output: "image",
        caption: "c".repeat(200),
        fields: { ssid: "Lab", hidden: "yes", security: "WEP", bogus: 1 },
    });
    assert.equal(s.content, "wifi");
    assert.equal(s.ecc, "M");
    assert.equal(s.quiet, 4);
    assert.equal(s.style, "dots");
    assert.equal(s.size, 1200);
    assert.equal(s.fg, "#abcdef");
    assert.equal(s.bg, "#ffffff");
    assert.equal(s.output, "image");
    assert.equal(s.caption.length, 80);
    assert.equal(s.fields.ssid, "Lab");
    assert.equal(s.fields.hidden, false);
    assert.equal(s.fields.security, "WEP");
    assert.equal("bogus" in s.fields, false);
});
