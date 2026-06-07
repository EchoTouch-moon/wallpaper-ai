import assert from "node:assert/strict";
import test from "node:test";
import { groupAssetsByColor, selectTriptychAssets } from "./colorGroup.ts";

function analysis(assetId, averageColor, resolutionScore = 0.8) {
  return {
    assetId,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 16 / 9,
    resolutionScore,
    dominantColors: [averageColor, averageColor, averageColor],
    averageColor,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

test("groups nearby hues and separates distant colors", () => {
  const groups = groupAssetsByColor([
    analysis("blue_1", "#4169e1"),
    analysis("blue_2", "#4f75df"),
    analysis("orange", "#ee7b32"),
  ]);

  assert.equal(groups[0].assets.length, 2);
  assert.equal(groups.length, 2);
});

test("selects three assets from the strongest color group", () => {
  const selected = selectTriptychAssets([
    analysis("blue_1", "#4169e1", 0.7),
    analysis("blue_2", "#4f75df", 0.9),
    analysis("blue_3", "#365fc9", 0.8),
    analysis("orange", "#ee7b32", 1),
  ]);

  assert.deepEqual(selected.assetIds, ["blue_2", "blue_3", "blue_1"]);
  assert.equal(selected.usedFallback, false);
});

test("falls back to the nearest color when the primary group is too small", () => {
  const selected = selectTriptychAssets([
    analysis("blue_1", "#4169e1", 1),
    analysis("blue_2", "#4f75df", 0.9),
    analysis("green", "#43a86b", 0.8),
    analysis("orange", "#ee7b32", 0.7),
  ]);

  assert.equal(selected.assetIds.length, 3);
  assert.equal(selected.usedFallback, true);
  assert.ok(selected.assetIds.includes("green"));
});
