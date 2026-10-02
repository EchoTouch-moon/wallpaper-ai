import assert from "node:assert/strict";
import test from "node:test";

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

const assets = [
  analysis("asset_a", "#456fd6"),
  analysis("asset_b", "#5278d8"),
  analysis("asset_c", "#5f83da"),
];

const brief = {
  ...createDefaultCompositionBrief({
    ratioId: "16:9",
    width: 3840,
    height: 2160,
    usage: "desktop",
  }),
  intent: {
    ...createDefaultCompositionBrief({
      ratioId: "16:9",
      width: 3840,
      height: 2160,
      usage: "desktop",
    }).intent,
    prompt: "",
    hierarchy: "hero-support",
    visualFlow: "left-to-right",
  },
};

// layered-collage compiles to background + hero + support-1 slots; the
// multimodal planner intermittently returns assignments for hero/support
// only (experiment v4 live observation).
const layeredCollageRecipe = {
  version: "1.0",
  profile: "dynamic",
  family: "layered-collage",
  heroPosition: "center",
  heroShare: 0.62,
  // Prompt contract: supportCount equals the number of assets minus one, so
  // 3 assets compile to background + hero + support-1 slots.
  supportCount: 2,
  margin: 0.03,
  gap: 0.012,
  cornerRadius: 0.018,
  rhythm: "asymmetric",
  boundary: "clean-gap",
  safeAreaPolicy: "soft-avoid",
};

function materialize(plan) {
  return createCompositionCandidateFromRecipe(
    { brief, assets, candidateCount: 3 },
    layeredCollageRecipe,
    0,
    plan,
  );
}

test("keeps the AI candidate when the model omits the layered-collage background assignment", () => {
  const candidate = materialize({
    id: "model_dynamic",
    label: "Model Dynamic",
    reason: "Layered depth with the calm hero floating on a dark base.",
    harmonyScore: 0.86,
    assignments: [
      { slotId: "hero", assetId: "asset_a", crop: null },
      { slotId: "support-1", assetId: "asset_b", crop: null },
      // background assignment omitted — must not throw, must not discard.
    ],
  });
  assert.equal(candidate.usedFallback, false);
  assert.equal(candidate.id, "model_dynamic");
  const assignedIds = candidate.layout.items.map((item) => item.assetId);
  assert.equal(assignedIds.length, 3);
  // The unassigned background slot takes an asset the model left unused, so
  // the slot→asset mapping stays a permutation.
  assert.equal(new Set(assignedIds).size, 3);
  assert.ok(assignedIds.includes("asset_c"));
  const background = candidate.layout.items.find(
    (item) => item.slotId === "background",
  );
  assert.ok(background);
  assert.equal(background.assetId, "asset_c");
});

test("falls back deterministically when the model hallucinates an asset id", () => {
  const candidate = materialize({
    id: "model_hallucinated",
    label: "Model Hallucinated",
    reason: "Assignments referencing a nonexistent asset.",
    harmonyScore: 0.8,
    assignments: [
      { slotId: "hero", assetId: "asset_a", crop: null },
      { slotId: "support-1", assetId: "asset_does_not_exist", crop: null },
      { slotId: "background", assetId: "asset_b", crop: null },
    ],
  });
  assert.equal(candidate.usedFallback, false);
  const assignedIds = candidate.layout.items.map((item) => item.assetId);
  // Every slot still carries a supplied asset; hallucinated ids never leak.
  assert.equal(new Set(assignedIds).size, 3);
  for (const assetId of assignedIds) {
    assert.ok(
      assets.some((asset) => asset.assetId === assetId),
      `unexpected asset id ${assetId}`,
    );
  }
});

test("full model assignments still win verbatim", () => {
  const candidate = materialize({
    id: "model_full",
    label: "Model Full",
    reason: "Complete assignment set.",
    harmonyScore: 0.9,
    assignments: [
      { slotId: "hero", assetId: "asset_c", crop: null },
      { slotId: "support-1", assetId: "asset_b", crop: null },
      { slotId: "background", assetId: "asset_a", crop: null },
    ],
  });
  const bySlot = new Map(
    candidate.layout.items.map((item) => [item.slotId, item.assetId]),
  );
  assert.equal(bySlot.get("hero"), "asset_c");
  assert.equal(bySlot.get("support-1"), "asset_b");
  assert.equal(bySlot.get("background"), "asset_a");
});
