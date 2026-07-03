import assert from "node:assert/strict";
import test from "node:test";
import { commitHistory, redoHistory, undoHistory } from "./history.ts";

test("undoes the first applied layout back to an empty canvas", () => {
  const applied = commitHistory(
    { current: null, past: [], future: [] },
    { id: "layout_1" },
  );
  const undone = undoHistory(applied);

  assert.equal(undone.target, null);
  assert.equal(undone.state.current, null);
  assert.deepEqual(undone.state.future, [{ id: "layout_1" }]);
});

test("redoes a layout and preserves the empty state in history", () => {
  const redone = redoHistory({
    current: null,
    past: [],
    future: [{ id: "layout_1" }],
  });

  assert.deepEqual(redone.target, { id: "layout_1" });
  assert.deepEqual(redone.state.past, [null]);
});

test("limits committed history entries", () => {
  let state = { current: null, past: [], future: [] };
  for (let index = 0; index < 55; index += 1) {
    state = commitHistory(state, { id: `layout_${index}` }, 50);
  }
  assert.equal(state.past.length, 50);
});
