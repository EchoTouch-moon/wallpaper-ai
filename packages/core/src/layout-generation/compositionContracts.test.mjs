import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultCompositionBrief } from "./compositionBrief.ts";
import {
  compositionGenerationRequestSchema,
  compositionRefineRequestSchema,
} from "./compositionContracts.ts";
import { generateCompositionCandidates } from "./generateCompositionCandidates.ts";
import { refineTemplateRecipe } from "./refineTemplateRecipe.ts";

function analysis(assetId, orientation = "landscape") {
  const dimensions =
    orientation === "portrait"
      ? { width: 1200, height: 1800 }
      : { width: 1920, height: 1080 };
  return {
    assetId,
    ...dimensions,
    orientation,
    aspectRatio: dimensions.width / dimensions.height,
    resolutionScore: 0.88,
    dominantColors: ["#456fd6", "#5278d8", "#3e64c0"],
    averageColor: "#456fd6",
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
    bestUse: assetId === "asset_b" ? ["hero"] : ["support"],
  };
}

function request(overrides = {}) {
  const brief = createDefaultCompositionBrief({
    ratioId: "16:9",
    width: 1920,
    height: 1080,
    usage: "desktop",
  });
  return {
    brief: {
      ...brief,
      intent: {
        ...brief.intent,
        heroAssetId: "asset_b",
        prompt: "Keep the hero prominent and leave room for desktop icons.",
      },
    },
    assets: [analysis("asset_a"), analysis("asset_b"), analysis("asset_c")],
    candidateCount: 3,
    ...overrides,
  };
}

test("generates three differentiated recipe candidates from a brief", () => {
  const response = generateCompositionCandidates(request());

  assert.equal(response.source, "recipe-fallback");
  assert.equal(response.candidates.length, 3);
  assert.deepEqual(
    response.candidates.map(
      (candidate) => candidate.layout.template?.recipe?.profile,
    ),
    ["safe", "editorial", "dynamic"],
  );
  assert.equal(
    new Set(
      response.candidates.map(
        (candidate) => candidate.layout.template?.recipe?.family,
      ),
    ).size,
    3,
  );
  response.candidates.forEach((candidate) => {
    const hero = candidate.layout.items.find((item) => item.role === "hero");
    assert.equal(hero?.assetId, "asset_b");
    assert.equal(candidate.layout.safeAreas.length, 2);
    assert.equal(candidate.layout.template?.source, "generated");
  });
});

test("supports two assets and a custom target", () => {
  const brief = createDefaultCompositionBrief({
    ratioId: "custom",
    width: 1440,
    height: 1440,
    usage: "desktop",
  });
  const response = generateCompositionCandidates({
    brief,
    assets: [analysis("asset_a"), analysis("asset_b", "portrait")],
    candidateCount: 3,
  });

  assert.equal(response.candidates.length, 3);
  response.candidates.forEach((candidate) => {
    assert.equal(candidate.layout.canvas.ratio, "custom");
    assert.equal(candidate.layout.canvas.width, 1440);
    assert.equal(candidate.layout.items.length, 2);
  });
});

test("moves the safe desktop hero away from the icon rail", () => {
  const response = generateCompositionCandidates(request());
  const safeRecipe = response.candidates[0].layout.template.recipe;

  assert.equal(safeRecipe.profile, "safe");
  assert.equal(safeRecipe.heroPosition, "right");
});

test("rejects a hero asset that is not in the composition", () => {
  const result = compositionGenerationRequestSchema.safeParse({
    ...request(),
    brief: {
      ...request().brief,
      intent: {
        ...request().brief.intent,
        heroAssetId: "missing_asset",
      },
    },
  });

  assert.equal(result.success, false);
});

test("refines recipe parameters without producing unbounded values", () => {
  const current = generateCompositionCandidates(request()).candidates[0].layout
    .template.recipe;
  const refined = refineTemplateRecipe(
    current,
    "主图更大，整体更有层次，右侧构图",
    3,
  );

  assert.equal(refined.family, "layered-collage");
  assert.equal(refined.heroPosition, "right");
  assert.ok(refined.heroShare > current.heroShare);
  assert.equal(refined.supportCount, 2);
});

test("accepts refine requests only for generated recipe layouts", () => {
  const generated = generateCompositionCandidates(request()).candidates[0]
    .layout;
  const valid = compositionRefineRequestSchema.safeParse({
    brief: request().brief,
    assets: request().assets,
    currentLayout: generated,
    instruction: "Give the composition more whitespace.",
    locked: {
      target: true,
      heroAsset: true,
      safeAreas: true,
    },
  });
  const invalid = compositionRefineRequestSchema.safeParse({
    brief: request().brief,
    assets: request().assets,
    currentLayout: {
      ...generated,
      template: {
        id: "registered_template",
        type: "triptych",
        source: "registered",
      },
    },
    instruction: "Give the composition more whitespace.",
    locked: {
      target: true,
      heroAsset: true,
      safeAreas: true,
    },
  });

  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});
