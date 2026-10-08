import assert from "node:assert/strict";
import test from "node:test";

import { getStyle } from "../layout/styleLibrary.ts";
import {
  compositionBriefSchema,
  createDefaultCompositionBrief,
} from "./compositionBrief.ts";
import { generateCompositionCandidates } from "./generateCompositionCandidates.ts";
import { generateCompositionCandidatesAsync } from "./generateCompositionCandidatesAsync.ts";
import { createPlanningRequestMessages } from "./layoutPlanPrompt.ts";
import { buildGeneratePlanningRequest } from "./planningProtocol.ts";

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

const sixAssets = [
  ...assets,
  analysis("asset_d", "#d6a24b"),
  analysis("asset_e", "#4bd6d0"),
  analysis("asset_f", "#a24bd6"),
];

function baseBrief() {
  const brief = createDefaultCompositionBrief({
    ratioId: "16:9",
    width: 1920,
    height: 1080,
    usage: "desktop",
  });
  return {
    ...brief,
    intent: { ...brief.intent, prompt: "A pinned reference style please." },
  };
}

function providerThatMustNotBeCalled() {
  return {
    async generatePlan() {
      throw new Error("provider must not be called in locked style mode");
    },
  };
}

// ---------------------------------------------------------------------------
// Brief contract: styleId / styleMode are optional and validated together.
// ---------------------------------------------------------------------------

test("the brief accepts a style pin and rejects a styleMode without styleId", () => {
  const brief = baseBrief();
  const pinned = compositionBriefSchema.parse({
    ...brief,
    styleId: "xhs-diagonal",
    styleMode: "locked",
  });
  assert.equal(pinned.styleId, "xhs-diagonal");
  assert.equal(pinned.styleMode, "locked");

  // styleId alone is legal (defaults to anchored downstream).
  assert.equal(compositionBriefSchema.parse({ ...brief, styleId: "xhs-diagonal" }).styleMode, undefined);

  assert.throws(
    () => compositionBriefSchema.parse({ ...brief, styleMode: "anchored" }),
    /styleMode requires a styleId/,
  );

  // Pre-style briefs parse unchanged: no injected keys.
  const legacy = compositionBriefSchema.parse(brief);
  assert.equal("styleId" in legacy, false);
  assert.equal("styleMode" in legacy, false);
  assert.deepEqual(legacy, brief);
});

// ---------------------------------------------------------------------------
// Locked mode: deterministic recipe compilation, no LLM.
// ---------------------------------------------------------------------------

test("locked mode compiles the style recipe deterministically without calling the provider", async () => {
  const brief = {
    ...baseBrief(),
    styleId: "xhs-diagonal",
    styleMode: "locked",
  };
  const first = await generateCompositionCandidatesAsync(
    { brief, assets: sixAssets, candidateCount: 3 },
    { provider: providerThatMustNotBeCalled() },
  );
  const second = await generateCompositionCandidatesAsync(
    { brief, assets: sixAssets, candidateCount: 3 },
    { provider: providerThatMustNotBeCalled() },
  );

  // Byte-identical across runs: the locked chain is fully deterministic.
  assert.deepEqual(second, first);

  assert.equal(first.source, "recipe-fallback");
  assert.equal(first.candidates.length, 3);
  assert.ok(
    first.warnings.some((warning) =>
      warning.includes('Style "xhs-diagonal" locked'),
    ),
  );

  const styleCandidate = first.candidates[0];
  assert.equal(styleCandidate.id, "style_xhs-diagonal");
  assert.equal(styleCandidate.label, "XHS Diagonal Collage");
  assert.ok(styleCandidate.reason.includes("reverse-engineered recipe"));

  // Family consistency and recipe fidelity: the layout carries the library
  // recipe verbatim, compiled to the diagonal slot structure (2 heroes +
  // 4 supports = 6 slots at 6 assets).
  const recipe = styleCandidate.layout.template?.recipe;
  assert.ok(recipe);
  assert.equal(recipe.family, "diagonal-collage");
  assert.deepEqual(recipe, getStyle("xhs-diagonal").recipe);
  assert.equal(styleCandidate.layout.template.type, "diagonal-collage");
  assert.deepEqual(
    styleCandidate.layout.items.map((item) => item.slotId).sort(),
    ["hero", "hero-2", "support-1", "support-2", "support-3", "support-4"],
  );
  // The diagonal background comes from the recipe (P1 reference olive tone).
  assert.equal(styleCandidate.layout.canvas.backgroundColor, "#5C6B4A");
});

test("locked mode adapts to a short asset set while keeping the family", async () => {
  const brief = {
    ...baseBrief(),
    styleId: "xhs-diagonal",
    styleMode: "locked",
  };
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    { provider: providerThatMustNotBeCalled() },
  );

  const styleCandidate = response.candidates[0];
  assert.equal(
    styleCandidate.layout.template.recipe.family,
    "diagonal-collage",
  );
  // 3 assets → trailing support slots drop (never a hero).
  assert.deepEqual(
    styleCandidate.layout.items.map((item) => item.slotId).sort(),
    ["hero", "hero-2", "support-1"],
  );
});

test("the sync generator honors locked styles identically", () => {
  const brief = {
    ...baseBrief(),
    styleId: "canva-kraft-polaroid",
    styleMode: "locked",
  };
  const response = generateCompositionCandidates({
    brief,
    assets,
    candidateCount: 3,
  });

  assert.equal(response.source, "recipe-fallback");
  const styleCandidate = response.candidates[0];
  assert.equal(styleCandidate.id, "style_canva-kraft-polaroid");
  assert.equal(styleCandidate.layout.template.recipe.family, "hero-grid");
  assert.deepEqual(
    styleCandidate.layout.template.recipe,
    getStyle("canva-kraft-polaroid").recipe,
  );
  // The two fillers come from the deterministic default set.
  assert.deepEqual(
    response.candidates
      .map((candidateItem) => candidateItem.id)
      .slice(1)
      .sort(),
    ["composition_editorial", "composition_safe"],
  );
});

test("an unknown styleId degrades observably instead of failing", async () => {
  const calls = [];
  const brief = {
    ...baseBrief(),
    styleId: "ghost-style",
    styleMode: "locked",
  };
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan(request) {
          calls.push(request);
          return modelPlanCandidates();
        },
      },
    },
  );

  // Unknown locked style: warning recorded, normal AI planning continued.
  assert.equal(calls.length, 1);
  assert.equal(response.source, "ai");
  assert.ok(
    response.warnings.some((warning) =>
      warning.includes('"ghost-style" is not in the style library'),
    ),
  );
});

// ---------------------------------------------------------------------------
// Anchored mode: LLM planning with the style anchor injected.
// ---------------------------------------------------------------------------

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

function modelPlanCandidates() {
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
}

test("anchored mode injects the style anchor into the planning request and prompt", async () => {
  const brief = {
    ...baseBrief(),
    styleId: "xhs-diagonal",
    styleMode: "anchored",
  };
  let capturedRequest;
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan(request) {
          capturedRequest = request;
          return modelPlanCandidates();
        },
      },
    },
  );

  assert.equal(response.source, "ai");

  // The planning request carries the anchor contract.
  assert.ok(capturedRequest.styleAnchor);
  assert.equal(capturedRequest.styleAnchor.styleId, "xhs-diagonal");
  assert.equal(capturedRequest.styleAnchor.family, "diagonal-collage");
  assert.ok(capturedRequest.styleAnchor.slotSummary.includes("hero-2"));
  assert.ok(capturedRequest.styleAnchor.slotSummary.includes("support-4"));
  assert.ok(
    capturedRequest.styleAnchor.styleNotes.includes(
      "strong diagonal axis from bottom-left to top-right",
    ),
  );

  // The assembled prompt anchors the model: family lock, slot structure, and
  // the styleNotes constraints and taboos.
  const messages = createPlanningRequestMessages(capturedRequest);
  for (const fragment of [
    "styleAnchor",
    "MUST use the anchor family exactly",
    "Follow the anchor slot structure",
    "Obey the styleNotes constraints and taboos verbatim",
  ]) {
    assert.ok(
      messages.system.includes(fragment),
      `anchored system rules must state "${fragment}"`,
    );
  }
  const payload = JSON.parse(messages.user);
  assert.equal(payload.styleAnchor.styleId, "xhs-diagonal");
  assert.ok(messages.user.includes("diagonal axis bl-tr"));
  assert.ok(
    messages.user.includes(
      "decorative text banners (标题, 装饰文字)",
    ),
  );
});

test("a styleId without styleMode defaults to anchored", async () => {
  const brief = { ...baseBrief(), styleId: "canva-polka-dot-plog" };
  let capturedRequest;
  await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan(request) {
          capturedRequest = request;
          return modelPlanCandidates();
        },
      },
    },
  );

  assert.equal(capturedRequest.styleAnchor.styleId, "canva-polka-dot-plog");
  assert.equal(capturedRequest.styleAnchor.family, "layered-collage");
  assert.ok(
    capturedRequest.styleAnchor.slotSummary.includes(
      "background, hero, support-1",
    ),
  );
});

// ---------------------------------------------------------------------------
// Regression: briefs without a styleId behave exactly as before.
// ---------------------------------------------------------------------------

test("unstyled briefs produce anchor-free requests and byte-identical prompts", async () => {
  const brief = baseBrief();

  const planning = buildGeneratePlanningRequest(brief, assets);
  assert.equal(planning.styleAnchor, undefined);

  const messages = createPlanningRequestMessages(planning);
  assert.equal(messages.system.includes("styleAnchor"), false);
  assert.equal(messages.system.includes("anchor family"), false);
  const payload = JSON.parse(messages.user);
  assert.equal("styleAnchor" in payload, false);

  // The async chain keeps its pre-style behavior with a working provider.
  let capturedRequest;
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan(request) {
          capturedRequest = request;
          return modelPlanCandidates();
        },
      },
    },
  );
  assert.equal(response.source, "ai");
  assert.equal(capturedRequest.styleAnchor, undefined);
  assert.deepEqual(capturedRequest.brief, brief);
  assert.deepEqual(response.warnings, []);
  assert.deepEqual(
    response.candidates.map((candidateItem) => candidateItem.id),
    ["model_safe", "model_editorial", "model_dynamic"],
  );

  // The sync deterministic tier keeps its exact pre-style shape.
  const deterministic = generateCompositionCandidates({
    brief,
    assets,
    candidateCount: 3,
  });
  assert.deepEqual(
    deterministic.candidates.map((candidateItem) => candidateItem.id),
    ["composition_safe", "composition_editorial", "composition_dynamic"],
  );
  assert.deepEqual(deterministic.warnings, []);
  assert.equal(deterministic.source, "recipe-fallback");
});
