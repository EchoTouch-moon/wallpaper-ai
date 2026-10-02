import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultCompositionBrief } from "./compositionBrief.ts";
import { generateCompositionCandidates } from "./generateCompositionCandidates.ts";
import {
  generateCompositionCandidatesAsync,
  refineCompositionCandidateAsync,
} from "./generateCompositionCandidatesAsync.ts";
import { LayoutProviderError } from "./openAiCompatibleProvider.ts";

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
          capturedRequest = input;
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
  assert.equal(capturedRequest.version, "2.0");
  assert.equal(capturedRequest.operation, "generate");
  assert.deepEqual(capturedRequest.brief, brief);
  assert.deepEqual(capturedRequest.assets, assets);
  assert.equal(capturedRequest.refineInstruction, undefined);
  assert.equal(capturedRequest.previousCandidates, undefined);
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

test("falls back to deterministic recipes when the planning provider fails", async () => {
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan() {
          throw new Error("Vision planning endpoint is down");
        },
      },
    },
  );

  assert.equal(response.source, "recipe-fallback");
  assert.equal(response.candidates.length, 3);
  assert.equal(
    response.candidates.every((item) => item.usedFallback),
    true,
  );
  assert.match(response.warnings[0], /AI planner unavailable: Vision planning endpoint is down/);
});

test("materializes registered-template candidates the model returns instead of dropping them", async () => {
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan() {
          return {
            candidates: [
              {
                ...candidate(
                  "model_template_only",
                  "safe",
                  "hero-grid",
                  ["hero", "support-1", "support-2"],
                ),
                recipe: null,
                templateId: "triptych_desktop_equal",
              },
            ],
          };
        },
      },
    },
  );

  // Planning protocol v2 lets the model answer with a registered template
  // (recipe null + templateId set); dropping it silently sank whole scenarios
  // into recipe-fallback (live experiment: E2/E3 at aiCount 0).
  assert.equal(response.source, "ai");
  assert.equal(response.candidates.length, 3);
  const modelCandidate = response.candidates.find(
    (item) => item.id === "model_template_only",
  );
  assert.ok(modelCandidate);
  assert.equal(modelCandidate.usedFallback, false);
  assert.equal(modelCandidate.layout.template?.source, "registered");
});

test("falls back when the registered template cannot serve the brief", async () => {
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan() {
          return {
            candidates: [
              {
                ...candidate(
                  "model_mobile_template",
                  "safe",
                  "hero-grid",
                  ["hero", "support-1", "support-2"],
                ),
                recipe: null,
                // Mobile-only template against the 16:9 desktop brief.
                templateId: "triptych_mobile_cinematic",
              },
            ],
          };
        },
      },
    },
  );

  assert.equal(response.source, "recipe-fallback");
  assert.equal(response.candidates.length, 3);
  assert.ok(
    response.warnings.some((warning) =>
      warning.includes("could not be materialized"),
    ),
  );
});

test("uses the model for natural-language recipe refinement", async () => {
  const current = generateCompositionCandidates({
    brief,
    assets,
    candidateCount: 3,
  }).candidates[0];
  let capturedOperation;
  let capturedInstruction;
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
          capturedInstruction = input.refineInstruction;
          capturedLayout = input.previousCandidates[0];
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
  assert.equal(
    capturedInstruction,
    "Make the layout more layered and move the hero right.",
  );
  assert.deepEqual(capturedLayout, current.layout);
});

test("falls back to deterministic refinement when the planning provider fails", async () => {
  const current = generateCompositionCandidates({
    brief,
    assets,
    candidateCount: 3,
  }).candidates[0];
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
        async generatePlan() {
          throw new Error("Vision planning endpoint is down");
        },
      },
    },
  );

  assert.equal(response.source, "recipe-fallback");
  assert.equal(
    response.candidate.layout.items.find((item) => item.role === "hero")
      .assetId,
    "asset_b",
  );
  assert.match(
    response.warnings[0],
    /AI refinement unavailable: Vision planning endpoint is down/,
  );
});

const assetContent = [
  {
    assetId: "asset_a",
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  },
  {
    assetId: "asset_c",
    dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  },
];

const visionGateOnEnvironment = {
  LLM_API_KEY: "test-key",
  LLM_MODEL: "test-model",
  VISION_PLANNING_ENABLED: "true",
  VISION_MODEL: "vision-model",
};

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

test("degrades from vision planning to text-only planning when the multimodal call fails", async () => {
  const calls = [];
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3, assetContent },
    {
      environment: visionGateOnEnvironment,
      provider: {
        async generatePlan(input) {
          calls.push(input);
          if (input.assetContent?.length) {
            throw new Error("vision endpoint exploded");
          }
          return modelPlanCandidates();
        },
      },
    },
  );

  assert.equal(response.source, "ai");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].assetContent, assetContent);
  assert.equal(calls[1].assetContent, undefined);
  assert.deepEqual(response.warnings, [
    "Vision planning failed; fell back to text-only planning. (vision endpoint exploded)",
  ]);
  assert.equal(
    response.candidates.every((item) => item.usedFallback),
    false,
  );
});

test("keeps a single text-only planning call when the vision gate is off", async () => {
  const calls = [];
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3, assetContent },
    {
      environment: { LLM_API_KEY: "test-key", LLM_MODEL: "test-model" },
      provider: {
        async generatePlan(input) {
          calls.push(input);
          return modelPlanCandidates();
        },
      },
    },
  );

  assert.equal(response.source, "ai");
  assert.equal(calls.length, 1);
  // The request contract still carries assetContent; the provider gate (off)
  // is what keeps the message assembly text-only.
  assert.deepEqual(calls[0].assetContent, assetContent);
  assert.deepEqual(response.warnings, []);
});

test("falls back to deterministic recipes when vision and text-only planning both fail", async () => {
  const calls = [];
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3, assetContent },
    {
      environment: visionGateOnEnvironment,
      provider: {
        async generatePlan(input) {
          calls.push(input);
          throw new Error("planning endpoint is down");
        },
      },
    },
  );

  assert.equal(response.source, "recipe-fallback");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].assetContent, assetContent);
  assert.equal(calls[1].assetContent, undefined);
  assert.equal(response.candidates.length, 3);
  assert.equal(
    response.candidates.every((item) => item.usedFallback),
    true,
  );
  assert.deepEqual(response.warnings, [
    "Vision planning failed; fell back to text-only planning. (planning endpoint is down)",
    "AI planner unavailable: planning endpoint is down",
  ]);
});

test("degrades the refinement path from vision planning to text-only planning", async () => {
  const current = generateCompositionCandidates({
    brief,
    assets,
    candidateCount: 3,
  }).candidates[0];
  const calls = [];
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
      assetContent,
    },
    {
      environment: visionGateOnEnvironment,
      provider: {
        async generatePlan(input) {
          calls.push(input);
          if (input.assetContent?.length) {
            throw new Error("vision endpoint exploded");
          }
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
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].assetContent, assetContent);
  assert.equal(calls[1].assetContent, undefined);
  assert.deepEqual(response.warnings, [
    "Vision planning failed; fell back to text-only planning. (vision endpoint exploded)",
  ]);
  assert.equal(
    response.candidate.layout.items.find((item) => item.role === "hero")
      .assetId,
    "asset_b",
  );
});

// ---------------------------------------------------------------------------
// Leftover issue ③ (intermittent invalid plan JSON): an invalid_response
// failure is retried once as an identical multimodal call BEFORE degrading to
// text-only; the retry outcome stays observable through warnings either way.
// ---------------------------------------------------------------------------

test("retries the identical multimodal call once when the vision plan JSON is invalid, then succeeds", async () => {
  const calls = [];
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3, assetContent },
    {
      environment: visionGateOnEnvironment,
      provider: {
        async generatePlan(input) {
          calls.push(input);
          if (calls.length === 1) {
            throw new LayoutProviderError(
              "invalid_response",
              "Layout model returned invalid plan JSON",
            );
          }
          return modelPlanCandidates();
        },
      },
    },
  );

  // Passing path: the retry is the SAME multimodal request (assetContent
  // preserved), the multimodal plan is used, and no text-only call happens.
  assert.equal(response.source, "ai");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].assetContent, assetContent);
  assert.deepEqual(calls[1].assetContent, assetContent);
  assert.deepEqual(response.warnings, [
    "Vision planning returned invalid plan JSON; one identical retry recovered the multimodal plan.",
  ]);
  assert.equal(
    response.candidates.every((item) => item.usedFallback),
    false,
  );
});

test("degrades to text-only planning when the invalid plan JSON retry fails again", async () => {
  const calls = [];
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3, assetContent },
    {
      environment: visionGateOnEnvironment,
      provider: {
        async generatePlan(input) {
          calls.push(input);
          if (input.assetContent?.length) {
            throw new LayoutProviderError(
              "invalid_response",
              "Layout model returned invalid plan JSON",
            );
          }
          return modelPlanCandidates();
        },
      },
    },
  );

  // Degradation path: multimodal → identical multimodal retry → text-only.
  assert.equal(response.source, "ai");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].assetContent, assetContent);
  assert.deepEqual(calls[1].assetContent, assetContent);
  assert.equal(calls[2].assetContent, undefined);
  assert.deepEqual(response.warnings, [
    "Vision planning retry failed; falling back to text-only planning. (Layout model returned invalid plan JSON)",
  ]);
  assert.equal(
    response.candidates.every((item) => item.usedFallback),
    false,
  );
});

// ---------------------------------------------------------------------------
// Compiled-facts appendix (experiment finding 7): the E4 model claimed "Null
// crops protect faces/text" while the compiler had resolved cover crops. The
// v2 assembly point appends one deterministic fact line to every model reason
// — never rewriting the model's own text — and leaves deterministic fallback
// copy untouched.
// ---------------------------------------------------------------------------

test("appends compiled crop facts to model reasons without altering them", async () => {
  const response = await generateCompositionCandidatesAsync(
    { brief, assets, candidateCount: 3 },
    {
      provider: {
        async generatePlan() {
          return {
            candidates: [
              candidate("model_safe", "safe", "hero-grid", [
                "hero",
                "support-1",
                "support-2",
              ]),
            ],
          };
        },
      },
    },
  );

  assert.equal(response.source, "ai");
  const modelCandidate = response.candidates.find(
    (item) => item.id === "model_safe",
  );
  const originalReason = "The model chose a hero-grid recipe.";

  assert.ok(modelCandidate.reason.startsWith(originalReason));
  assert.match(
    modelCandidate.reason,
    /\n\[compiled\] hero crop x=\d+\.\d{2} w=\d+\.\d{2}; 3 slots$/,
  );

  // The appendix numbers state the layout as compiled, countering reason
  // hallucinations about null or protective crops.
  const hero = modelCandidate.layout.items.find(
    (item) => item.role === "hero",
  );
  assert.ok(modelCandidate.reason.includes(`x=${hero.crop.x.toFixed(2)}`));
  assert.ok(modelCandidate.reason.includes(`w=${hero.crop.width.toFixed(2)}`));

  // Deterministic fills keep their static copy, byte-identical.
  for (const item of response.candidates.filter(
    (candidate) => candidate.id !== "model_safe",
  )) {
    assert.equal(item.usedFallback, true);
    assert.doesNotMatch(item.reason, /\[compiled\]/);
  }
});
