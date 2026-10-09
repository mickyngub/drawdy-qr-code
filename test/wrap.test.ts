import assert from "node:assert/strict";
import { test } from "node:test";
import { breakWord, wrapCaption } from "../webview/lib/wrap";

// One unit per grapheme keeps the arithmetic obvious.
const measure = (text: string) =>
    Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)).length;

test("spaced captions wrap at spaces", () => {
    assert.deepEqual(wrapCaption("scan me for the menu", 10, measure), [
        "scan me",
        "for the",
        "menu",
    ]);
});

test("a Thai caption without spaces wraps inside the box instead of running off both edges", () => {
    const thai = "สแกนเพื่อดูเมนูอาหารวันนี้";
    const lines = wrapCaption(thai, 8, measure);
    assert.ok(lines.length > 1);
    assert.ok(lines.every((line) => measure(line) <= 8), lines.join(" | "));
    assert.equal(lines.join(""), thai);
});

test("a word too wide for a line breaks by word first, then by grapheme", () => {
    const fits = (text: string) => measure(text) <= 4;
    assert.deepEqual(breakWord("abc", fits), ["abc"]);
    const parts = breakWord("supercalifragilistic", fits);
    assert.ok(parts.every(fits));
    assert.equal(parts.join(""), "supercalifragilistic");
    const marks = breakWord("ที่นี่ที่นั่น", (text) => measure(text) <= 2);
    assert.equal(marks.join(""), "ที่นี่ที่นั่น");
    assert.ok(marks.every((part) => measure(part) <= 2));
});
