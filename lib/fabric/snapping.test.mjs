import assert from "node:assert/strict";
import test from "node:test";
import { findClosestSnap } from "./snapping.ts";

test("snaps the closest object edge within the visual threshold", () => {
  assert.deepEqual(
    findClosestSnap([100, 150, 200], [{ value: 204 }, { value: 320 }], 8),
    { delta: 4, guide: 204 },
  );
});

test("does not snap at or beyond the threshold", () => {
  assert.deepEqual(
    findClosestSnap([100, 150, 200], [{ value: 208 }], 8),
    { delta: 0 },
  );
});
