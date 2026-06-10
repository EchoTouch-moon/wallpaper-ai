import assert from "node:assert/strict";
import test from "node:test";
import { swapLayoutItemAssets } from "./swap.ts";

const mockLayout = {
  version: "1.0",
  canvas: {
    width: 1920,
    height: 1080,
    ratio: "16:9",
    usage: "desktop",
    backgroundColor: "#ffffff",
  },
  items: [
    {
      id: "item_1",
      assetId: "asset_A",
      role: "hero",
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      fit: "cover",
    },
    {
      id: "item_2",
      assetId: "asset_B",
      role: "support",
      x: 600,
      y: 0,
      width: 500,
      height: 500,
      rotation: 0,
      zIndex: 2,
      opacity: 1,
      fit: "cover",
    },
  ],
  safeAreas: [],
  guidance: {
    intent: "balanced-collage",
    visualFlow: "left-to-right",
    transition: { type: "clean-gap", strength: 0.2, feather: 0 },
    boundary: { type: "clean-gap", gap: 24, radius: 0, width: 0 },
    preserveFaces: true,
    preserveNegativeSpace: true,
  },
};

test("swaps assetId between item_1 and item_2", () => {
  const result = swapLayoutItemAssets(mockLayout, "item_1", "item_2");

  const item1 = result.items.find((item) => item.id === "item_1");
  const item2 = result.items.find((item) => item.id === "item_2");

  assert.equal(item1.assetId, "asset_B");
  assert.equal(item2.assetId, "asset_A");
});

test("returns original layout if items are not found", () => {
  const result = swapLayoutItemAssets(mockLayout, "item_1", "non_existent");
  assert.deepEqual(result, mockLayout);
});
