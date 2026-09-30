import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultCompositionBrief } from "./compositionBrief.ts";
import { generateCompositionCandidates } from "./generateCompositionCandidates.ts";
import {
  generateCompositionCandidatesAsync,
  refineCompositionCandidateAsync,
} from "./generateCompositionCandidatesAsync.ts";

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
  analysis("asset_b", "#d65b80"),
  analysis("asset_c", "#46a47a"),
];

const brief = {
  ...createDefaultCompositionBrief({
    ratioId: "16:9",
    width: 1920,
    height: 1080,
    usage: "desktop",
  }),
  intent: {
    ...createDefaultCompositionBrief({
      ratioId: "16:9",
      width: 1920,
      height: 1080,
      usage: "desktop",
    }).intent,
    prompt: "Keep the second asset as hero and leave room for icons.",
    heroAssetId: "asset_b",
  },
};

function recipe(profile, family) {
  return {
    version: "1.0",
    profile,
    family,
    heroPosition: profile === "safe" ? "left" : "center",
    heroShare: profile === "dynamic" ? 0.62 : 0.52,
    supportCount: 2,
    margin: 0.02,
    gap: 0.01,
    cornerRadius: 0.018,
    rhythm:
      profile === "safe"
        ? "ordered"
        : profile === "editorial"
          ? "asymmetric"
          : "layered",
    boundary:
      profile === "dynamic"
        ? "overlap"
        : profile === "editorial"
          ? "soft-shadow"
          : "clean-gap",
    safeAreaPolicy: profile === "safe" ? "avoid" : "soft-avoid",
  };
}

function candidate(id, profile, family, slotIds) {
  return {
    id,
    label: `${profile} model candidate`,
    reason: `The model chose a ${family} recipe.`,
    harmonyScore: 0.9,
    templateId: null,
    recipe: recipe(profile, family),
    assignments: slotIds.map((slotId, index) => ({
      slotId,
      assetId: assets[index].assetId,
      crop: null,
    })),
    backgroundColor: null,
  };
}

test("uses model recipes while preserving explicit brief constraints", async () => {
  let capturedRequest;
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan(input) {
          capturedRequest = input.request;
          return {
            candidates: [
              candidate("model_safe", "safe", "hero-grid", [
                "hero",
                "support-1",
                "support-2",
              ]),
              candidate("model_editorial", "editorial", "balanced-mosaic", [
                "hero",
                "support-1",
                "support-2",
              ]),
              candidate("model_dynamic", "dynamic", "layered-collage", [
                "background",
                "hero",
                "support-1",
              ]),
            ],
          };
        },
      },
    },
  );

  assert.equal(response.source, "ai");
  assert.deepEqual(
    response.candidates.map((item) => item.id),
    ["model_safe", "model_editorial", "model_dynamic"],
  );
  response.candidates.forEach((item) => {
    assert.equal(item.usedFallback, false);
    assert.equal(
      item.layout.items.find((layoutItem) => layoutItem.role === "hero")
        .assetId,
      "asset_b",
    );
  });
  assert.equal(capturedRequest.intent.userPrompt, brief.intent.prompt);
});

test("falls back when the composition model is not configured", async () => {
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    { environment: {} },
  );

  assert.equal(response.source, "recipe-fallback");
  assert.equal(response.candidates.length, 3);
  assert.match(response.warnings[0], /LLM_API_KEY/);
});

test("uses the model for natural-language recipe refinement", async () => {
  const current = generateCompositionCandidates({
    brief,
    assets,
    candidateCount: 3,
  }).candidates[0];
  let capturedOperation;
  let capturedLayout;
  const response = await refineCompositionCandidateAsync(
    {
      brief,
      assets,
      currentLayout: current.layout,
      instruction: "Make the layout more layered and move the hero right.",
      locked: {
        target: true,
        heroAsset: true,
        safeAreas: true,
      },
    },
    {
      provider: {
        async generatePlan(input) {
          capturedOperation = input.operation;
          capturedLayout = input.request.currentLayout;
          return {
            candidates: [
              candidate(
                "model_refinement",
                "dynamic",
                "layered-collage",
                ["background", "hero", "support-1"],
              ),
            ],
          };
        },
      },
    },
  );

  assert.equal(response.source, "ai");
  assert.equal(response.candidate.id, "model_refinement");
  assert.equal(
    response.candidate.layout.template.recipe.family,
    "layered-collage",
  );
  assert.equal(
    response.candidate.layout.items.find((item) => item.role === "hero")
      .assetId,
    "asset_b",
  );
  assert.equal(capturedOperation, "refine");
  assert.deepEqual(capturedLayout, current.layout);
});
