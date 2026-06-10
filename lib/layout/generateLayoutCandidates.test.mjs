import assert from "node:assert/strict";
import test from "node:test";
import { generateLayoutCandidates } from "./generateLayoutCandidates.ts";

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
  analysis("asset_a", "#456fd6"),
  analysis("asset_b", "#5278d8"),
  analysis("asset_c", "#3e64c0", "portrait"),
];

test("generates validated first-version layout candidates", () => {
  const result = generateLayoutCandidates({
    analyses,
    canvasSize: { width: 1920, height: 1080 },
    ratioId: "16:9",
  });

  assert.equal(result.rejected.length, 0);
  assert.equal(result.candidates.length, 3);
  assert.ok(
    result.candidates.some(
      (candidate) => candidate.layout.template.type !== "triptych",
    ),
  );
  result.candidates.forEach((candidate) => {
    assert.equal(candidate.layout.version, "1.0");
    assert.equal(candidate.layout.canvas.ratio, "16:9");
    assert.ok(candidate.layout.items.length >= 3);
  });
});

test("honors the max candidate limit", () => {
  const result = generateLayoutCandidates({
    analyses,
    canvasSize: { width: 1920, height: 1080 },
    ratioId: "16:9",
    maxCandidates: 2,
  });

  assert.equal(result.candidates.length, 2);
});

test("orders candidates by composition intent", () => {
  const heroResult = generateLayoutCandidates({
    analyses,
    canvasSize: { width: 1920, height: 1080 },
    ratioId: "16:9",
    intent: "hero-with-support",
  });
  assert.equal(
    heroResult.candidates[0].layout.template.id,
    "triptych_desktop_editorial",
  );

  const storyResult = generateLayoutCandidates({
    analyses,
    canvasSize: { width: 1920, height: 1080 },
    ratioId: "16:9",
    intent: "story-strip",
  });
  assert.equal(
    storyResult.candidates[0].layout.template.id,
    "triptych_desktop_cinematic",
  );
});

test("rejects invalid generation input before template planning", () => {
  assert.throws(
    () =>
      generateLayoutCandidates({
        analyses: analyses.slice(0, 2),
        canvasSize: { width: 1920, height: 1080 },
        ratioId: "16:9",
      }),
    /At least three/,
  );

  assert.throws(
    () =>
      generateLayoutCandidates({
        analyses: [analyses[0], analyses[0], analyses[2]],
        canvasSize: { width: 1920, height: 1080 },
        ratioId: "16:9",
      }),
    /Duplicate analyzed asset id/,
  );
});
