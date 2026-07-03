import assert from "node:assert/strict";
import test from "node:test";
import { generateTriptychCandidates } from "./planTriptych.ts";

function analysis(assetId, averageColor, orientation = "landscape") {
  const dimensions =
    orientation === "portrait"
      ? { width: 1200, height: 1800 }
      : { width: 1920, height: 1080 };
  return {
    assetId,
    ...dimensions,
    orientation,
    aspectRatio: dimensions.width / dimensions.height,
    resolutionScore: 0.8,
    dominantColors: [averageColor, averageColor, averageColor],
    averageColor,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const analyses = [
  analysis("a", "#456fd6"),
  analysis("b", "#5278d8"),
  analysis("c", "#3e64c0", "portrait"),
];

test("generates three desktop candidates with absolute geometry", () => {
  const candidates = generateTriptychCandidates(
    analyses,
    { width: 1920, height: 1080 },
    "16:9",
  );

  assert.equal(candidates.length, 3);
  assert.deepEqual(
    candidates.map((candidate) => candidate.layout.template.id),
    [
      "triptych_desktop_equal",
      "triptych_desktop_editorial",
      "triptych_desktop_cinematic",
    ],
  );
  candidates.forEach((candidate) => {
    assert.equal(candidate.layout.items.length, 3);
    candidate.layout.items.forEach((item) => {
      assert.ok(item.x + item.width <= 1920);
      assert.ok(item.y + item.height <= 1080);
    });
  });
});

test("generates mobile layouts and biases portrait crop upward in wide slots", () => {
  const candidates = generateTriptychCandidates(
    analyses,
    { width: 1080, height: 1920 },
    "9:16",
  );
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].layout.canvas.usage, "mobile");
  const portraitItem = candidates[1].layout.items.find(
    (item) => item.assetId === "c",
  );
  assert.ok(portraitItem.crop.y >= 0);
});
