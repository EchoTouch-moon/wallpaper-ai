import assert from "node:assert/strict";
import test from "node:test";
import {
  findClosestSnap,
  resolveAxisSnap,
} from "./snapping.ts";

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

test("keeps the locked guide until the wider release threshold is crossed", () => {
  const lock = { anchorIndex: 0, guide: 100 };
  const state = resolveAxisSnap(
    [110],
    [{ value: 100 }, { value: 112 }],
    8,
    14,
    lock,
  );

  assert.deepEqual(state, {
    result: { delta: -10, guide: 100 },
    lock,
  });
});

test("releases a locked guide and acquires the nearest replacement", () => {
  const state = resolveAxisSnap(
    [116],
    [{ value: 100 }, { value: 120 }],
    8,
    14,
    { anchorIndex: 0, guide: 100 },
  );

  assert.deepEqual(state, {
    result: { delta: 4, guide: 120 },
    lock: { anchorIndex: 0, guide: 120 },
  });
});

test("drops a lock after release when no guide is inside the snap threshold", () => {
  assert.deepEqual(
    resolveAxisSnap(
      [116],
      [{ value: 100 }, { value: 140 }],
      8,
      14,
      { anchorIndex: 0, guide: 100 },
    ),
    {
      result: { delta: 0 },
      lock: null,
    },
  );
});

test("stays stable across a drag sequence near the same guide", () => {
  let lock = null;
  const deltas = [104, 108, 111, 113, 115].map((anchor) => {
    const state = resolveAxisSnap(
      [anchor],
      [{ value: 100 }],
      8,
      14,
      lock,
    );
    lock = state.lock;
    return state.result.delta;
  });

  assert.deepEqual(deltas, [-4, -8, -11, -13, 0]);
  assert.equal(lock, null);
});
