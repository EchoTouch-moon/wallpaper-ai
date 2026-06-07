import assert from "node:assert/strict";
import test from "node:test";
import {
  fabricGeometryToLayoutItem,
  layoutItemToFabricGeometry,
} from "./layoutGeometry.ts";

test("round-trips layout geometry and normalized crop", () => {
  const item = {
    id: "item_1",
    assetId: "asset_1",
    role: "hero",
    x: 120,
    y: 80,
    width: 960,
    height: 720,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    fit: "cover",
    crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
  };
  const original = { width: 2400, height: 1600 };
  const geometry = layoutItemToFabricGeometry(item, original);
  const serialized = fabricGeometryToLayoutItem(geometry, original);

  assert.deepEqual(serialized, {
    x: 120,
    y: 80,
    width: 960,
    height: 720,
    crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
  });
});
