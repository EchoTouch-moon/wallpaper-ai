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

// ---------------------------------------------------------------------------
// Semantic control vocabulary passthrough (protocol v2 §2.2): the plan
// schema embeds templateRecipeSchema, so slot-level cropIntent /
// visualWeight and recipe-level layering flow through without extra
// translation — and out-of-vocabulary values are rejected at the boundary.
// ---------------------------------------------------------------------------

const recipeWithKnobs = {
  version: "1.0",
  profile: "dynamic",
  family: "layered-collage",
  heroPosition: "center",
  heroShare: 0.62,
  supportCount: 2,
  margin: 0.025,
  gap: 0.008,
  cornerRadius: 0.026,
  rhythm: "layered",
  boundary: "overlap",
  safeAreaPolicy: "soft-avoid",
  slotIntents: {
    hero: { cropIntent: { focus: "subject", zoom: "tight" }, visualWeight: "dominant" },
    "support-1": { cropIntent: { focus: { x: 0.25, y: 0.75 }, zoom: "loose" } },
  },
  layering: "strong",
};

function recipePlan(recipe) {
  return {
    candidates: [
      {
        id: "ai_recipe_knobs",
        label: "Layered with intent",
        reason: "Semantic knobs drive focus, weight, and layering.",
        harmonyScore: 0.9,
        templateId: null,
        recipe,
        assignments: [
          { slotId: "background", assetId: "asset_a", crop: null },
          { slotId: "hero", assetId: "asset_b", crop: null },
          { slotId: "support-1", assetId: "asset_c", crop: null },
        ],
        backgroundColor: null,
      },
    ],
  };
}

// hero-grid produces hero + support-N slots (no background).
function heroGridPlan(recipe, heroCrop = null) {
  return {
    candidates: [
      {
        id: "ai_recipe_knobs",
        label: "Hero grid with intent",
        reason: "Semantic knobs drive focus, weight, and layering.",
        harmonyScore: 0.9,
        templateId: null,
        recipe,
        assignments: [
          { slotId: "hero", assetId: "asset_b", crop: heroCrop },
          { slotId: "support-1", assetId: "asset_a", crop: null },
          { slotId: "support-2", assetId: "asset_c", crop: null },
        ],
        backgroundColor: null,
      },
    ],
  };
}

test("plan schema passes recipe semantic knobs through", () => {
  const result = aiLayoutPlanResponseSchema.parse(recipePlan(recipeWithKnobs));

  assert.equal(result.candidates[0].recipe.layering, "strong");
  assert.equal(
    result.candidates[0].recipe.slotIntents.hero.cropIntent.focus,
    "subject",
  );
  assert.equal(
    result.candidates[0].recipe.slotIntents["support-1"].visualWeight,
    undefined,
  );
});

test("plan schema rejects out-of-vocabulary semantic knobs", () => {
  const result = aiLayoutPlanResponseSchema.safeParse(
    recipePlan({
      ...recipeWithKnobs,
      slotIntents: { hero: { cropIntent: { zoom: "extreme" } } },
    }),
  );
  assert.equal(result.success, false);
});

test("compiler-mapped crop intents reach the materialized hero item", () => {
  // Landscape 16:9 sources in a near-square hero slot: the cover crop is a
  // horizontal band of width 0.56; focus "subject" re-centers that band on
  // the subject box center (0.7, 0.4).
  const knobbedRequest = {
    ...request,
    assets: [
      analysis("asset_a", "#456fd6"),
      {
        ...analysis("asset_b", "#5278d8"),
        subjectBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.4 },
      },
      analysis("asset_c", "#3e64c0"),
    ],
  };
  const safeHeroGridRecipe = {
    ...recipeWithKnobs,
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
    slotIntents: { hero: { cropIntent: { focus: "subject" } } },
  };
  const candidates = materializeAiLayoutPlan(
    heroGridPlan(safeHeroGridRecipe),
    knobbedRequest,
  );

  const hero = candidates[0].layout.items.find((item) => item.role === "hero");
  assert.equal(hero.assetId, "asset_b");
  assert.deepEqual(hero.crop.focalPoint, { x: 0.7, y: 0.4 });
  assert.ok(Math.abs(hero.crop.width - 0.56) < 1e-4);
  assert.ok(hero.crop.x <= 0.7 && 0.7 <= hero.crop.x + hero.crop.width);
  assert.ok(hero.crop.y >= 0 && hero.crop.y + hero.crop.height <= 1);
});

test("an explicit model crop still wins over the recipe crop intent", () => {
  const knobbedAssets = [
    analysis("asset_a", "#456fd6"),
    {
      ...analysis("asset_b", "#5278d8"),
      subjectBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.4 },
    },
    analysis("asset_c", "#3e64c0"),
  ];
  const safeHeroGridRecipe = {
    ...recipeWithKnobs,
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
    slotIntents: { hero: { cropIntent: { focus: "subject" } } },
  };
  const explicit = materializeAiLayoutPlan(
    heroGridPlan(safeHeroGridRecipe, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      focalPoint: null,
    }),
    { ...request, assets: knobbedAssets },
  );
  const hero = explicit[0].layout.items.find((item) => item.role === "hero");
  assert.deepEqual(
    {
      x: hero.crop.x,
      y: hero.crop.y,
      width: hero.crop.width,
      height: hero.crop.height,
    },
    { x: 0, y: 0, width: 1, height: 1 },
  );
});

// ---------------------------------------------------------------------------
// Compiled-facts appendix (experiment finding 7): the materialized candidate
// keeps the model's reason verbatim and gains one deterministic line stating
// the crops that actually compiled.
// ---------------------------------------------------------------------------

test("appends deterministic compiled facts below the untouched model reason", () => {
  const originalReason =
    "The hero remains prominent while support images stay ordered.";
  const candidates = materializeAiLayoutPlan(
    {
      candidates: [
        {
          ...plan(assignments).candidates[0],
          reason: originalReason,
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
        },
      ],
    },
    request,
  );

  const reason = candidates[0].reason;
  assert.ok(reason.startsWith(originalReason));
  assert.match(
    reason,
    /\n\[compiled\] hero crop x=\d+\.\d{2} w=\d+\.\d{2}; 3 slots$/,
  );

  // The appended numbers are the compiled hero crop, not model prose.
  const hero = candidates[0].layout.items.find((item) => item.role === "hero");
  assert.ok(reason.includes(`x=${hero.crop.x.toFixed(2)}`));
  assert.ok(reason.includes(`w=${hero.crop.width.toFixed(2)}`));
});
