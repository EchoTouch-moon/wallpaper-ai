import assert from "node:assert/strict";
import test from "node:test";
import { createSafeAreas } from "./layoutSafeAreas.ts";

test("creates desktop icon and dock safe areas inside the canvas", () => {
  const areas = createSafeAreas("16:9", 1920, 1080);
  assert.deepEqual(
    areas.map((area) => area.type),
    ["desktop-icons-left", "desktop-dock"],
  );
  areas.forEach((area) => {
    assert.ok(area.x + area.width <= 1920);
    assert.ok(area.y + area.height <= 1080);
  });
});

test("creates mobile clock and widget safe areas", () => {
  const areas = createSafeAreas("9:16", 1080, 1920);
  assert.deepEqual(
    areas.map((area) => area.type),
    ["mobile-clock", "mobile-widget-center"],
  );
});
