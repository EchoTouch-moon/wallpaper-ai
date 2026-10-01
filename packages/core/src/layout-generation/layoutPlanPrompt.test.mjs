import assert from "node:assert/strict";
import test from "node:test";

import { WALLPAPER_TEMPLATES } from "../layout/templates.ts";
import { createDefaultCompositionBrief } from "./compositionBrief.ts";
import { generateCompositionCandidates } from "./generateCompositionCandidates.ts";
import {
  AI_LAYOUT_PLAN_JSON_SCHEMA,
  createLayoutPlanMessages,
  createPlanningRequestMessages,
} from "./layoutPlanPrompt.ts";
import { buildGeneratePlanningRequest, buildRefinePlanningRequest } from "./planningProtocol.ts";

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

function visionAnalysis(assetId, color) {
  return {
    ...analysis(assetId, color),
    contentType: "pet",
    faces: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.25 }],
    subjectBox: { x: 0.15, y: 0.1, width: 0.55, height: 0.6 },
    saliencyCenter: { x: 0.62, y: 0.4 },
    styleTags: ["airy", "natural-light"],
    bestUse: ["hero", "background"],
    cropSafety: "low",
  };
}

const assets = [
  visionAnalysis("asset_a", "#456fd6"),
  visionAnalysis("asset_b", "#d65b80"),
  visionAnalysis("asset_c", "#46a47a"),
];

const brief = {
  ...createDefaultCompositionBrief({
    ratioId: "16:9",
    width: 1920,
    height: 1080,
    usage: "desktop",
  }),
  intent: {
    prompt: "An airy coastal triptych that leaves the left side quiet.",
    heroAssetId: "asset_b",
    hierarchy: "single-hero",
    density: "minimal",
    rhythm: "layered",
    visualFlow: "center-out",
    moodTags: ["calm", "coastal"],
  },
};

function currentLayout() {
  return generateCompositionCandidates({
    brief,
    assets,
    candidateCount: 3,
  }).candidates[0].layout;
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("the v2 prompt consumes every brief semantic field natively", () => {
  const messages = createPlanningRequestMessages(
    buildGeneratePlanningRequest(brief, assets),
  );
  const payload = JSON.parse(messages.user);

  // The protocol envelope carries the native brief verbatim.
  assert.equal(payload.version, "2.0");
  assert.equal(payload.operation, "generate");
  assert.deepEqual(payload.brief, brief);
  assert.equal(payload.userPrompt, brief.intent.prompt);
  assert.equal(payload.heroAssetId, "asset_b");

  // Every structural semantic value survives in the prompt text.
  for (const semantic of [
    "single-hero",
    "minimal",
    "layered",
    "center-out",
    "heroAssetId",
    "asset_b",
    brief.intent.prompt,
    "16:9",
    "desktop",
    "preserveFaces",
    "preserveText",
    "cropTolerance",
    "safeAreas",
    "desktop-icons-left",
  ]) {
    assert.ok(
      messages.user.includes(semantic),
      `the v2 prompt must mention "${semantic}"`,
    );
  }

  // The system rules explain how each brief field maps to recipe semantics.
  for (const rule of [
    "hierarchy",
    "density",
    "rhythm",
    "visualFlow",
    "heroAssetId",
    "preserveFaces",
    "preserveText",
    "cropTolerance",
    "safeAreas",
    "desktop",
    "ultrawide",
    "lock-screen",
    "clock",
    "target",
    "brief prompt",
  ]) {
    assert.ok(
      messages.system.includes(rule),
      `the v2 system rules must explain "${rule}"`,
    );
  }

  // The vision patches of the asset analyses travel with the prompt.
  for (const patch of [
    "contentType",
    "faces",
    "subjectBox",
    "saliencyCenter",
    "0.62",
    "natural-light",
    "bestUse",
    "cropSafety",
    "low",
  ]) {
    assert.ok(
      messages.user.includes(patch),
      `the v2 prompt must include the asset patch "${patch}"`,
    );
  }
  assert.ok(messages.system.includes("subjectBox"));
  assert.ok(messages.system.includes("saliencyCenter"));
  assert.ok(messages.system.includes("styleTags"));
  assert.ok(messages.system.includes("bestUse"));
  assert.ok(messages.system.includes("cropSafety"));

  // The output contract is unchanged and the same schema is attached.
  assert.equal(
    messages.system.includes("Return JSON only. Never return markdown or UI instructions."),
    true,
  );
  assert.equal(
    messages.system.includes(
      "Recipe supportCount must equal the number of assets minus one.",
    ),
    true,
  );
  assert.equal(messages.system.includes("Return exactly 3 candidates."), true);
  assert.deepEqual(payload.outputSchema, AI_LAYOUT_PLAN_JSON_SCHEMA);
  assert.deepEqual(
    payload.registeredTemplates,
    WALLPAPER_TEMPLATES.filter((template) =>
      template.supportedRatios.includes("16:9"),
    ),
  );
});

test("the v2 prompt no longer flattens the brief into legacy intent enums", () => {
  const messages = createPlanningRequestMessages(
    buildGeneratePlanningRequest(brief, assets),
  );
  const payload = JSON.parse(messages.user);

  for (const legacyKey of [
    "canvas",
    "style",
    "compositionIntent",
    "currentLayout",
  ]) {
    assert.ok(
      !(legacyKey in payload),
      `the v2 prompt must not carry the legacy key "${legacyKey}"`,
    );
  }
  assert.ok(!messages.user.includes('"style":"auto"'));
  assert.ok(!messages.user.includes('"hero-with-support"'));

  // Refine-only fields stay out of generate requests.
  assert.equal(payload.refineInstruction, null);
  assert.equal(payload.previousCandidates, null);
});

test("the v2 refine prompt carries the instruction and previous candidates", () => {
  const layout = currentLayout();
  const messages = createPlanningRequestMessages(
    buildRefinePlanningRequest(
      brief,
      assets,
      "Make the layout more layered and move the hero right.",
      [layout],
    ),
  );
  const payload = JSON.parse(messages.user);

  assert.equal(payload.operation, "refine");
  assert.equal(
    payload.refineInstruction,
    "Make the layout more layered and move the hero right.",
  );
  assert.deepEqual(payload.previousCandidates, [jsonClone(layout)]);
  assert.equal(messages.system.includes("Return exactly 1 candidate."), true);
  assert.ok(messages.system.includes("previousCandidates"));
  assert.ok(messages.system.includes("refineInstruction"));
});

test("the legacy prompt for the frozen GenerateLayoutRequest path is unchanged", () => {
  const legacyInput = {
    operation: "generate",
    request: {
      operation: "generate",
      canvas: { width: 1920, height: 1080, ratioId: "16:9" },
      intent: {
        mode: "ai",
        style: "same-tone-triptych",
        compositionIntent: "single-hero",
        safeArea: "desktop-left",
        count: 3,
        userPrompt: "A calm coastal wallpaper",
      },
      assets,
      options: { candidateCount: 3, allowFallback: true },
    },
  };
  const messages = createLayoutPlanMessages(legacyInput);
  const payload = JSON.parse(messages.user);

  assert.equal(
    messages.system,
    [
      "You plan editable photo wallpaper layouts.",
      "Return JSON only. Never return markdown or UI instructions.",
      "Prefer a parameterized recipe. Use a registered template only when refining a registered layout.",
      "For a recipe candidate set templateId to null. For a registered candidate set recipe to null.",
      "Recipe supportCount must equal the number of assets minus one.",
      "When returning three candidates, return exactly one safe, one editorial, and one dynamic recipe profile.",
      "Use stable generated slot IDs: hero, support-1 onward; layered-collage also starts with background.",
      "Assign every template slot exactly once.",
      "Use only supplied asset IDs.",
      "Do not create canvas coordinates, Fabric objects, polygons, image URLs, or image data.",
      "Use null when no crop or background override is needed.",
      "Return exactly 3 candidates.",
    ].join(" "),
  );
  assert.equal(payload.operation, "generate");
  assert.equal(payload.userPrompt, "A calm coastal wallpaper");
  assert.deepEqual(payload.canvas, legacyInput.request.canvas);
  assert.equal(payload.style, "same-tone-triptych");
  assert.equal(payload.compositionIntent, "single-hero");
  assert.deepEqual(payload.assets, assets);
  assert.equal(payload.currentLayout, null);
  assert.deepEqual(
    payload.registeredTemplates,
    WALLPAPER_TEMPLATES.filter((template) =>
      template.supportedRatios.includes("16:9"),
    ),
  );
  assert.deepEqual(payload.outputSchema, AI_LAYOUT_PLAN_JSON_SCHEMA);
});

test("the legacy refine prompt still sends the current layout", () => {
  const layout = currentLayout();
  const messages = createLayoutPlanMessages({
    operation: "refine",
    request: {
      operation: "refine",
      canvas: { width: 1920, height: 1080, ratioId: "16:9" },
      intent: {
        mode: "ai",
        style: "auto",
        count: 1,
        userPrompt: "Make it calmer",
      },
      assets,
      currentLayout: layout,
      options: { candidateCount: 1, allowFallback: false },
    },
  });
  const payload = JSON.parse(messages.user);

  assert.deepEqual(payload.currentLayout, jsonClone(layout));
  assert.equal(messages.system.includes("Return exactly 1 candidate."), true);
});
