import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candidateRects,
  centredIn,
  findFreeRect,
  firstFreeRect,
  overlaps,
  revealAndSelect,
  rightOf,
  union,
  visibleArea,
} from "../src/lib/free-spot";

type Rect = { x: number; y: number; width: number; height: number };

// Answers the way the Drawdy host does: `{ res: { value } }`, ids as `id`.
function fakeHost(board: { id: string; type: string; rect: Rect }[]) {
  const sent: { type: string; req: unknown }[] = [];
  const values: Record<string, (req: any) => unknown> = {
    "command:camera:get-viewport-rect": () => ({
      rect: { x: 0, y: 0, width: 1440, height: 900 },
    }),
    "command:camera:get-info": () => ({ x: 0, y: 0, zoom: 1 }),
    "command:dom:element-rect": () => ({
      x: 1080,
      y: 180,
      width: 320,
      height: 534,
    }),
    "command:camera:screen-to-canvas": (req) => ({ x: req.x, y: req.y }),
    "command:scene:query-rect": (req) => ({
      drawdyElements: board
        .filter((e) => overlaps(e.rect, req.rect))
        .map((e) => ({ id: e.id, type: e.type })),
    }),
    "command:scene:element-rects": (req) => ({
      rects: board
        .filter((e) => req.drawdyElementIds.includes(e.id))
        .map((e) => ({ drawdyElementId: e.id, rect: e.rect })),
    }),
  };
  let n = 0;
  const ctx = {
    driverId: "test.driver",
    nextRequestId: () => String(n++),
    webviewDomId: "test.driver:webview",
    issueCommand: (async (cmd: { type: string; req: unknown }) => {
      sent.push({ type: cmd.type, req: cmd.req });
      return { res: { value: values[cmd.type]?.(cmd.req) } };
    }) as any,
  };
  return { ctx, sent };
}

test("against host-shaped answers, a second placement steps past the first", async () => {
  const first = box(0, 0);
  const { ctx } = fakeHost([{ id: "a", type: "shape", rect: first }]);
  const spot = await findFreeRect(ctx, first);
  assert.equal(spot.x, first.width + 40);
});

test("frames and the element being replaced don't block a spot", async () => {
  const preferred = box(0, 0);
  const { ctx } = fakeHost([
    { id: "frame", type: "frame", rect: box(-500, -500, 2000, 2000) },
    { id: "old", type: "image", rect: preferred },
  ]);
  assert.deepEqual(await findFreeRect(ctx, preferred, ["old"]), preferred);
});

test("the visible area stops at the drawer's left edge", async () => {
  const { ctx } = fakeHost([]);
  const area = await visibleArea(ctx);
  assert.ok(area);
  assert.equal(area.x + area.width, 1080 - 16);
});

test("a result already in view is selected without moving the camera", async () => {
  const { ctx, sent } = fakeHost([]);
  await revealAndSelect(ctx, ["new"], box(100, 100));
  assert.deepEqual(sent[0], {
    type: "command:scene:set-selection",
    req: { drawdyElementIds: ["new"] },
  });
  assert.equal(
    sent.some((s) => s.type.startsWith("command:camera:fly")),
    false,
  );
});

test("a result under the drawer brings the camera to it", async () => {
  const { ctx, sent } = fakeHost([]);
  await revealAndSelect(ctx, ["new"], box(1200, 100));
  assert.equal(sent.at(-1)?.type, "command:camera:fly-to-rect");
});

const box = (x: number, y: number, width = 100, height = 50) => ({
  x,
  y,
  width,
  height,
});

test("the preferred spot wins when nothing is in the way", () => {
  const preferred = box(0, 0);
  assert.deepEqual(firstFreeRect(candidateRects(preferred), []), preferred);
});

test("a second placement steps right of the first instead of stacking on it", () => {
  const first = box(0, 0);
  const spot = firstFreeRect(candidateRects(first), [first]);
  assert.ok(spot);
  assert.equal(spot.y, 0);
  assert.equal(spot.x, first.width + 40);
  assert.equal(overlaps(spot, first, 40), false);
});

test("a full row moves the search to the next row down", () => {
  const preferred = box(0, 0);
  const row = candidateRects(preferred).slice(0, 4);
  const spot = firstFreeRect(candidateRects(preferred), row);
  assert.ok(spot);
  assert.equal(spot.x, 0);
  assert.equal(spot.y, preferred.height + 40);
});

test("no free spot among the candidates gives null", () => {
  const preferred = box(0, 0);
  const wall = box(-1000, -1000, 100000, 100000);
  assert.equal(firstFreeRect(candidateRects(preferred), [wall]), null);
});

test("touching rects within the gap count as overlapping", () => {
  assert.equal(overlaps(box(0, 0), box(120, 0), 40), true);
  assert.equal(overlaps(box(0, 0), box(141, 0), 40), false);
});

test("union, centring and right-of placement", () => {
  assert.deepEqual(union([box(0, 0), box(200, 100)]), box(0, 0, 300, 150));
  assert.equal(union([]), null);
  assert.deepEqual(centredIn(box(0, 0, 1000, 500), 100, 50), box(450, 225));
  assert.deepEqual(rightOf(box(0, 0), 30, 30), box(140, 0, 30, 30));
});
