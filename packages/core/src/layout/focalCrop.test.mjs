import assert from "node:assert/strict";
import test from "node:test";

import { calculateCoverCrop } from "./planTemplate.ts";

function analysis(extra = {}) {
  return {
    assetId: "asset",
    width: 2000,
    height: 1000,
    orientation: "landscape",
    aspectRatio: 2,
    resolutionScore: 0.9,
    dominantColors: ["#112233", "#223344", "#334455"],
    averageColor: "#223344",
    brightness: 0.5,
    saturation: 0.4,
    contrast: 0.4,
    ...extra,
  };
}

test("moves a narrow crop toward detected faces", () => {
  const crop = calculateCoverCrop(
    analysis({
      faces: [{ x: 0.75, y: 0.2, width: 0.15, height: 0.3 }],
      saliencyCenter: { x: 0.2, y: 0.5 },
    }),
    500,
    1000,
  );

  assert.ok(crop.x > 0.5);
  assert.equal(crop.focalPoint.x, 0.825);
  assert.ok(crop.x + crop.width <= 1);
});

test("uses the subject box when no faces are available", () => {
  const crop = calculateCoverCrop(
    analysis({
      subjectBox: { x: 0.05, y: 0.2, width: 0.2, height: 0.6 },
    }),
    500,
    1000,
  );

  assert.ok(crop.x < 0.1);
  assert.ok(Math.abs(crop.focalPoint.x - 0.15) < 1e-9);
});
