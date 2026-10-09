import assert from "node:assert/strict";
import { test } from "node:test";
import type { DriverManifest } from "@drawdy/driver-protocol";
import * as driver from "../src/index";
import { overlaps } from "../src/lib/free-spot";
import { DEFAULT_SPEC, type QrSpec } from "../src/shared/spec";
import { boot, fakeHost, type FakeHost } from "./fake-host";

const manifest = {
    driverId: "mickyngub.qr-code",
    driverName: "QR Code",
} as DriverManifest;

// 128 characters at M and square modules needs more than 500 shapes, the old batch size.
const spec: QrSpec = {
    ...DEFAULT_SPEC,
    fields: {
        ...DEFAULT_SPEC.fields,
        url: `https://example.com/${"menu/".repeat(21)}x`,
    },
};

function codes(host: FakeHost): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const el of host.elements.values()) {
        const id = el.groupId as string;
        out.set(id, [...(out.get(id) ?? []), el.drawdyElementId]);
    }
    return out;
}

const cardOf = (host: FakeHost, ids: string[]) =>
    ids
        .map((id) => host.elements.get(id)!)
        .find((el) => el.width === spec.size)!;

const rectOf = (el: Record<string, unknown>) => ({
    x: el.x as number,
    y: el.y as number,
    width: el.width as number,
    height: el.height as number,
});

test("activate asks for nothing that prompts: no storage, no scene subscription", async () => {
    const host = fakeHost();
    await boot(driver, host, manifest);
    const types = host.types();
    assert.ok(!types.some((t) => t.startsWith("command:kv-storage")));
    assert.ok(!types.some((t) => t.startsWith("subscription:scene")));
});

test("a code goes on in one add call, a second one lands beside it, and each is selected", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);
    await message({ type: "ready" });
    await message({ type: "place", spec });
    await message({ type: "place", spec });
    const adds = host.sent.filter(
        (s) => s.type === "command:scene:add-drawdy-elements"
    );
    assert.equal(adds.length, 2);
    const placed = [...codes(host).values()];
    assert.equal(placed.length, 2);
    assert.ok(placed[0].length > 500, "a code past one old batch");
    assert.equal(adds[0].req.elements.length, placed[0].length);
    assert.equal(
        overlaps(
            rectOf(cardOf(host, placed[0])),
            rectOf(cardOf(host, placed[1]))
        ),
        false
    );
    const selections = host.sent
        .filter((s) => s.type === "command:scene:set-selection")
        .map((s) => s.req.drawdyElementIds);
    assert.deepEqual(selections, placed);
    assert.ok(!host.types().includes("command:camera:fly-to-elements"));
    assert.deepEqual(host.posted.at(-1), {
        type: "placed",
        mode: "new",
        count: placed[1].length,
    });
});

test("update uses where the code is now, not where it was at Edit selected", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);
    await message({ type: "ready" });
    await message({ type: "place", spec });
    const [[groupId, oldIds]] = [...codes(host)];
    const before = rectOf(cardOf(host, oldIds));
    host.select([oldIds[0]]);
    await message({ type: "edit" });
    assert.equal(host.posted.at(-1).type, "load");
    for (const id of oldIds) {
        const el = host.elements.get(id)!;
        host.put({ ...el, y: (el.y as number) + 250, layer: 2 });
    }
    host.clear();
    await message({ type: "update", spec: { ...spec, fg: "#1e3a8a" } });

    const order = host
        .types()
        .filter((t) => /remove-drawdy|add-drawdy/.test(t));
    assert.deepEqual(order, [
        "command:scene:remove-drawdy-elements",
        "command:scene:add-drawdy-elements",
    ]);
    assert.ok(oldIds.every((id) => !host.elements.has(id)));
    const fresh = codes(host).get(groupId)!;
    const card = cardOf(host, fresh);
    assert.equal(card.x, before.x);
    assert.equal(card.y, before.y + 250);
    assert.ok(fresh.every((id) => host.elements.get(id)!.layer === 2));
    assert.deepEqual(host.posted.at(-1), {
        type: "placed",
        mode: "update",
        count: fresh.length,
        undoSteps: 2,
        rotationReset: false,
    });
});

test("a failed add after the remove is undone, so the old code comes back", async () => {
    const host = fakeHost();
    const first = await boot(driver, host, manifest);
    await first.message({ type: "ready" });
    await first.message({ type: "place", spec });
    const oldIds = [...host.elements.keys()];
    const failing = fakeHost({ failAdd: true });
    for (const id of oldIds) failing.put(host.elements.get(id)!);
    failing.select([oldIds[0]]);
    const { message } = await boot(driver, failing, manifest);
    await message({ type: "ready" });
    await message({ type: "edit" });
    await message({ type: "update", spec });
    assert.ok(failing.types().includes("command:history:undo"));
    assert.ok(oldIds.every((id) => failing.elements.has(id)));
    assert.equal(failing.posted.at(-1).type, "error");
});

test("a full board is reported instead of a silent success", async () => {
    const host = fakeHost({ full: true });
    const { message } = await boot(driver, host, manifest);
    await message({ type: "ready" });
    await message({ type: "place", spec });
    assert.deepEqual(host.posted.at(-1), {
        type: "error",
        message: driver.BOARD_FULL,
    });
});

test("a denied board read ends in a clear message, not a hang", async () => {
    const host = fakeHost({ denied: ["command:scene"] });
    const { message } = await boot(driver, host, manifest);
    await message({ type: "ready" });
    host.clear();
    await message({ type: "edit" });
    assert.deepEqual(host.posted.at(-1), {
        type: "error",
        message: driver.NEEDS_PERMISSION,
    });
});

test("undo and redo from the panel go to the board history", async () => {
    const host = fakeHost();
    const { message } = await boot(driver, host, manifest);
    await message({ type: "undo" });
    await message({ type: "redo" });
    const types = host.types();
    assert.ok(types.includes("command:history:undo"));
    assert.ok(types.includes("command:history:redo"));
});
