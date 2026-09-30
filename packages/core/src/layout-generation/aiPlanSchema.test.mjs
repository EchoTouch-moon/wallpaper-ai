import assert from "node:assert/strict";
import test from "node:test";

import { aiLayoutPlanResponseSchema } from "./aiPlanSchema.ts";
import {
  AiLayoutPlanError,
  materializeAiLayoutPlan,
  materializeAiLayoutPlanSafely,
} from "./materializeAiLayoutPlan.ts";

function analysis(assetId, averageColor) {
  return {
    assetId,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 1920 / 1080,
    resolutionScore: 0.88,
    dominantColors: [averageColor, averageColor, averageColor],
    averageColor,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const request = {
  operation: "generate",
  canvas: { width: 1920, height: 1080, ratioId: "16:9" },
  intent: {
    mode: "ai",
    style: "same-tone-triptych",
    compositionIntent: "balanced-collage",
  },
  assets: [
    analysis("asset_a", "#456fd6"),
    analysis("asset_b", "#5278d8"),
    analysis("asset_c", "#3e64c0"),
  ],
  options: { candidateCount: 3, allowFallback: true },
};

function plan(assignments) {
  return {
    candidates: [
      {
        id: "ai_candidate_1",
        label: "Balanced triptych",
        reason: "The images share a cool color palette.",
        harmonyScore: 0.9,
        templateId: "triptych_desktop_equal",
        assignments,
        backgroundColor: null,
      },
    ],
  };
}

const assignments = [
  { slotId: "left", assetId: "asset_a", crop: null },
  { slotId: "center", assetId: "asset_b", crop: null },
  { slotId: "right", assetId: "asset_c", crop: null },
];

test("materializes a constrained AI plan through a registered template", () => {
  const candidates = materializeAiLayoutPlan(plan(assignments), request);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].layout.template.id, "triptych_desktop_equal");
  assert.deepEqual(
    candidates[0].layout.items.map((item) => item.assetId),
    ["asset_a", "asset_b", "asset_c"],
  );
  assert.equal(candidates[0].layout.items[0].x, 35);
});

test("compiles and materializes a constrained recipe plan", () => {
  const recipePlan = {
    candidates: [
      {
        id: "ai_recipe_1",
        label: "Safe hero grid",
        reason: "The hero remains prominent while support images stay ordered.",
        harmonyScore: 0.92,
        templateId: null,
        recipe: {
          version: "1.0",
          profile: "safe",
          family: "hero-grid",
          heroPosition: "left",
          heroShare: 0.56,
          supportCount: 2,
          margin: 0.02,
          gap: 0.012,
          cornerRadius: 0.018,
          rhythm: "ordered",
          boundary: "clean-gap",
          safeAreaPolicy: "avoid",
        },
        assignments: [
          { slotId: "hero", assetId: "asset_a", crop: null },
          { slotId: "support-1", assetId: "asset_b", crop: null },
          { slotId: "support-2", assetId: "asset_c", crop: null },
        ],
        backgroundColor: null,
      },
    ],
  };

  const candidates = materializeAiLayoutPlan(recipePlan, request);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].layout.template.source, "generated");
  assert.equal(candidates[0].layout.template.recipe.profile, "safe");
  assert.equal(candidates[0].layout.items.length, 3);
  assert.deepEqual(
    candidates[0].layout.items.map((item) => item.assetId),
    ["asset_a", "asset_b", "asset_c"],
  );
});

test("rejects a plan without a registered template or recipe", () => {
  const result = aiLayoutPlanResponseSchema.safeParse({
    candidates: [
      {
        ...plan(assignments).candidates[0],
        templateId: null,
      },
    ],
  });

  assert.equal(result.success, false);
});

test("rejects duplicate slot assignments at the schema boundary", () => {
  const result = aiLayoutPlanResponseSchema.safeParse(
    plan([
      assignments[0],
      { ...assignments[1], slotId: "left" },
      assignments[2],
    ]),
  );

  assert.equal(result.success, false);
});

test("rejects unknown assets and missing template slots", () => {
  assert.throws(
    () =>
      materializeAiLayoutPlan(
        plan([
          assignments[0],
          assignments[1],
          { ...assignments[2], assetId: "unknown" },
        ]),
        request,
      ),
    AiLayoutPlanError,
  );

  assert.throws(
    () => materializeAiLayoutPlan(plan(assignments.slice(0, 2)), request),
    AiLayoutPlanError,
  );
});

test("isolates a materialization failure to one model candidate", () => {
  const result = materializeAiLayoutPlanSafely(
    {
      candidates: [
        plan(assignments).candidates[0],
        {
          ...plan(assignments).candidates[0],
          id: "broken_candidate",
          assignments: assignments.map((assignment, index) =>
            index === 2
              ? { ...assignment, assetId: "unknown" }
              : assignment,
          ),
        },
      ],
    },
    request,
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].candidateId, "broken_candidate");
});

test("rejects normalized crop boxes that leave the source image", () => {
  const result = aiLayoutPlanResponseSchema.safeParse(
    plan([
      {
        ...assignments[0],
        crop: {
          x: 0.8,
          y: 0,
          width: 0.4,
          height: 1,
          focalPoint: null,
        },
      },
      assignments[1],
      assignments[2],
    ]),
  );

  assert.equal(result.success, false);
});
