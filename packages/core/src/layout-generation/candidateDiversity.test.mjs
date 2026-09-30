import assert from "node:assert/strict";
import test from "node:test";

import { candidateDiversityScore, selectDiverseLayoutCandidates } from "./candidateDiversity.ts";
import { generateRecipeLayouts } from "./generateRecipeLayouts.ts";

function analysis(assetId, color) {
  return {
    assetId,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 16 / 9,
    resolutionScore: 0.88,
    dominantColors: [color, color, color],
    averageColor: color,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const request = {
  canvas: { width: 1920, height: 1080, ratioId: "16:9" },
  intent: {
    mode: "ai",
    style: "auto",
    compositionIntent: "hero-with-support",
    count: 3,
  },
  assets: [
    analysis("asset_a", "#456fd6"),
    analysis("asset_b", "#5278d8"),
    analysis("asset_c", "#3e64c0"),
  ],
  options: { candidateCount: 3, allowFallback: true },
};

test("scores the three fallback profiles as materially different", () => {
  const candidates = generateRecipeLayouts(request).candidates;

  assert.ok(candidateDiversityScore(candidates[0], candidates[1]) >= 0.18);
  assert.ok(candidateDiversityScore(candidates[0], candidates[2]) >= 0.18);
  assert.ok(candidateDiversityScore(candidates[1], candidates[2]) >= 0.18);
});

test("removes a near duplicate and fills the set from fallback candidates", () => {
  const fallback = generateRecipeLayouts(request).candidates;
  const duplicate = {
    ...fallback[0],
    id: "duplicate_safe",
  };
  const selection = selectDiverseLayoutCandidates(
    [fallback[0], duplicate],
    fallback.slice(1),
    3,
  );

  assert.equal(selection.candidates.length, 3);
  assert.ok(selection.skippedCandidateIds.includes("duplicate_safe"));
  assert.deepEqual(
    selection.candidates.map(
      (candidate) => candidate.layout.template.recipe.profile,
    ),
    ["safe", "editorial", "dynamic"],
  );
});
