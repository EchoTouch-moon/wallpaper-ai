import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePixels,
  colorDistance,
  rgbToHsl,
} from "./colorAnalysis.ts";

test("uses circular hue distance around red", () => {
  const left = { hue: 359, saturation: 1, lightness: 0.5 };
  const right = { hue: 1, saturation: 1, lightness: 0.5 };
  assert.ok(colorDistance(left, right) < 0.01);
});

test("extracts average and three dominant colors while ignoring transparency", () => {
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255,
    255, 0, 0, 255,
    0, 0, 255, 255,
    0, 255, 0, 0,
  ]);
  const analysis = analyzePixels({
    assetId: "asset_1",
    width: 2,
    height: 2,
    pixels,
  });

  assert.equal(analysis.averageColor, "#aa0055");
  assert.equal(analysis.dominantColors.length, 3);
  assert.equal(analysis.orientation, "square");
  assert.ok(analysis.contrast > 0);
});

test("converts primary red to HSL", () => {
  assert.deepEqual(rgbToHsl(255, 0, 0), {
    hue: 0,
    saturation: 1,
    lightness: 0.5,
  });
});
