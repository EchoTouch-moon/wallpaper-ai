import assert from "node:assert/strict";
import test from "node:test";

import {
  SAME_COMBINATION_GEOMETRY_FLOOR,
  candidateDiversityScore,
  candidateStructuralCombo,
  selectDiverseLayoutCandidates,
} from "./candidateDiversity.ts";
import { generateRecipeLayouts } from "./generateRecipeLayouts.ts";
import { createDefaultCompositionBrief } from "./compositionBrief.ts";
import { createCompositionCandidateFromRecipe } from "./generateCompositionCandidates.ts";

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

// ---------------------------------------------------------------------------
// Same-combination near-duplicate guard (experiment finding 5): E3 shipped two
// model candidates with family=hero-grid and heroPosition=top that differed
// only through profile-style knobs; the combination guard must reject the
// second one so a different family fills the slot — while same-combination
// candidates whose compiled geometry genuinely differs stay selectable.
// ---------------------------------------------------------------------------

function combinationCandidate(
  id,
  { ratioId, width, height, usage },
  heroPosition,
  overrides,
) {
  const brief = {
    ...createDefaultCompositionBrief({ ratioId, width, height, usage }),
    intent: {
      ...createDefaultCompositionBrief({ ratioId, width, height, usage }).intent,
      prompt: "",
      hierarchy: "hero-support",
      visualFlow: usage === "mobile" ? "top-to-bottom" : "left-to-right",
    },
  };
  return createCompositionCandidateFromRecipe(
    {
      brief,
      assets: request.assets,
      candidateCount: 3,
    },
    {
      version: "1.0",
      profile: "safe",
      family: "hero-grid",
      heroPosition,
      heroShare: 0.45,
      supportCount: 2,
      margin: 0.03,
      gap: 0.012,
      cornerRadius: 0.018,
      rhythm: "ordered",
      boundary: "clean-gap",
      safeAreaPolicy: "avoid",
      ...overrides,
    },
    0,
    {
      id,
      label: id,
      reason: `The model chose a ${heroPosition} hero-grid.`,
      harmonyScore: 0.9,
      assignments: ["hero", "support-1", "support-2"].map((slotId, index) => ({
        slotId,
        assetId: request.assets[index].assetId,
        crop: null,
      })),
    },
  );
}

test("rejects a same (family, heroPosition) candidate with similar geometry and fills from another family", () => {
  // E3 shape (9:16, hero-grid top): identical combination, only profile-style
  // knobs differ — the diversity score alone lets the pair through.
  const safeTop = combinationCandidate(
    "model_safe_top",
    { ratioId: "9:16", width: 1440, height: 2560, usage: "mobile" },
    "top",
    {},
  );
  const dynamicTop = combinationCandidate(
    "model_dynamic_top",
    { ratioId: "9:16", width: 1440, height: 2560, usage: "mobile" },
    "top",
    {
      profile: "dynamic",
      heroShare: 0.68,
      margin: 0.015,
      gap: 0.02,
      rhythm: "layered",
      boundary: "overlap",
      safeAreaPolicy: "soft-avoid",
    },
  );

  assert.equal(candidateStructuralCombo(safeTop), candidateStructuralCombo(dynamicTop));
  assert.ok(candidateDiversityScore(safeTop, dynamicTop) >= 0.18);

  const fallback = generateRecipeLayouts(request).candidates;
  const selection = selectDiverseLayoutCandidates(
    [safeTop, dynamicTop],
    fallback,
    3,
  );

  assert.ok(selection.skippedCandidateIds.includes("model_dynamic_top"));
  assert.equal(selection.candidates.length, 3);
  assert.ok(selection.candidates.includes(safeTop));
  // Every fill-in candidate leaves the hero-grid|top combination behind.
  for (const candidate of selection.candidates.slice(1)) {
    assert.notEqual(
      candidateStructuralCombo(candidate),
      candidateStructuralCombo(safeTop),
    );
  }
});

test("keeps a same (family, heroPosition) candidate when the compiled geometry genuinely differs", () => {
  // heroShare pulled to the schema bounds inside one combination: geometry
  // distance clears the floor, so the legitimate difference survives.
  const compact = combinationCandidate(
    "model_compact",
    { ratioId: "16:9", width: 1920, height: 1080, usage: "desktop" },
    "left",
    { heroShare: 0.4 },
  );
  const sweeping = combinationCandidate(
    "model_sweeping",
    { ratioId: "16:9", width: 1920, height: 1080, usage: "desktop" },
    "left",
    {
      profile: "dynamic",
      heroShare: 0.76,
      rhythm: "layered",
      boundary: "overlap",
      safeAreaPolicy: "soft-avoid",
    },
  );

  assert.equal(
    candidateStructuralCombo(compact),
    candidateStructuralCombo(sweeping),
  );
  assert.ok(candidateDiversityScore(compact, sweeping) >= 0.18);
  assert.ok(
    SAME_COMBINATION_GEOMETRY_FLOOR > 0.1196 && SAME_COMBINATION_GEOMETRY_FLOOR < 0.1424,
  );

  const selection = selectDiverseLayoutCandidates(
    [compact, sweeping],
    [],
    2,
  );

  assert.deepEqual(selection.candidates, [compact, sweeping]);
  assert.deepEqual(selection.skippedCandidateIds, []);
});
