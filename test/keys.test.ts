import assert from "node:assert/strict";
import { test } from "node:test";
import { keyAction } from "../webview/lib/keys";

const key = (key: string, mods: Partial<Record<string, boolean>> = {}) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
});

test("⌘Z and Ctrl+Z undo on the board when focus is not in a field", () => {
    assert.equal(keyAction(key("z", { metaKey: true }), false), "undo");
    assert.equal(keyAction(key("z", { ctrlKey: true }), false), "undo");
    assert.equal(
        keyAction(key("Z", { metaKey: true, shiftKey: true }), false),
        "redo"
    );
    assert.equal(
        keyAction(key("z", { ctrlKey: true, shiftKey: true }), false),
        "redo"
    );
    assert.equal(keyAction(key("y", { ctrlKey: true }), false), "redo");
    assert.equal(keyAction(key("z"), false), null);
});

test("inside a field the browser keeps its own undo", () => {
    assert.equal(keyAction(key("z", { metaKey: true }), true), null);
    assert.equal(keyAction(key("y", { ctrlKey: true }), true), null);
});

test("Escape leaves a field instead of closing the panel", () => {
    assert.equal(keyAction(key("Escape"), true), "blur");
    assert.equal(keyAction(key("Escape"), false), "close");
});
