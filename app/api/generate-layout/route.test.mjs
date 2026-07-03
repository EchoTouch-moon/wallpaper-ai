import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvalidJsonResponse,
  handleGenerateLayoutRequest,
  handleGenerateLayoutRequestAsync,
} from "@wallpaper/core/layout-generation";

function analysis(assetId, averageColor) {
  return {
    assetId,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 1920 / 1080,
    resolutionScore: 0.8,
    dominantColors: [averageColor, averageColor, averageColor],
    averageColor,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const requestBody = {
  canvas: { width: 1920, height: 1080, ratioId: "16:9" },
  intent: { mode: "mock-ai", style: "auto", count: 3 },
  assets: [
    analysis("asset_a", "#456fd6"),
    analysis("asset_b", "#5278d8"),
    analysis("asset_c", "#3e64c0"),
  ],
};

test("generate-layout API returns candidates for a valid request", async () => {
  const response = handleGenerateLayoutRequest(requestBody);

  assert.equal(response.status, 200);
  assert.equal(response.body.source, "mock-ai");
  assert.equal(response.body.candidates.length, 3);
});

test("generate-layout API returns 400 for invalid requests", async () => {
  const response = handleGenerateLayoutRequest({
    ...requestBody,
    intent: { ...requestBody.intent, mode: "invalid" },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Invalid generate-layout request");
  assert.equal(response.body.code, "invalid_request");
  assert.ok(response.body.issues.length > 0);
});

test("generate-layout API returns 400 for malformed JSON", () => {
  const response = createInvalidJsonResponse();

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "invalid_json");
  assert.equal(response.body.issues[0].path, "body");
});

test("generate-layout API rejects frontend-only image payload fields", () => {
  const response = handleGenerateLayoutRequest({
    ...requestBody,
    assets: requestBody.assets.map((asset, index) =>
      index === 0
        ? {
            ...asset,
            objectUrl: "blob:http://localhost/image",
          }
        : asset,
    ),
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "invalid_request");
  assert.equal(response.body.issues[0].path, "assets.0.objectUrl");
});

test("generate-layout API rejects duplicate asset ids", () => {
  const response = handleGenerateLayoutRequest({
    ...requestBody,
    assets: [
      analysis("asset_a", "#456fd6"),
      analysis("asset_a", "#5278d8"),
      analysis("asset_c", "#3e64c0"),
    ],
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "invalid_request");
  assert.ok(
    response.body.issues.some((issue) => issue.path === "assets.1.assetId"),
  );
});

test("generate-layout API returns 422 when AI fallback is disabled", () => {
  const response = handleGenerateLayoutRequest({
    ...requestBody,
    intent: { ...requestBody.intent, mode: "ai" },
    options: { allowFallback: false },
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.code, "generation_failed");
  assert.match(response.body.error, /fallback is disabled/);
});

test("generate-layout async API path falls back when model config is missing", async () => {
  const response = await handleGenerateLayoutRequestAsync({
    ...requestBody,
    intent: { ...requestBody.intent, mode: "ai" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.source, "fallback");
  assert.ok(response.body.warnings?.[0].includes("LLM_API_KEY"));
});

test("generate-layout async API path returns 422 when config fallback is disallowed", async () => {
  const response = await handleGenerateLayoutRequestAsync({
    ...requestBody,
    intent: { ...requestBody.intent, mode: "ai" },
    options: { allowFallback: false },
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.code, "generation_failed");
  assert.match(response.body.error, /LLM_API_KEY/);
});

test("generate-layout async API materializes an injected provider plan", async () => {
  const response = await handleGenerateLayoutRequestAsync(
    {
      ...requestBody,
      operation: "generate",
      intent: { ...requestBody.intent, mode: "ai", count: 1 },
      options: { candidateCount: 1, allowFallback: false },
    },
    {
      provider: {
        async generatePlan() {
          return {
            candidates: [
              {
                id: "provider_candidate",
                label: "Provider triptych",
                reason: "The provider selected a registered template.",
                harmonyScore: 0.91,
                templateId: "triptych_desktop_equal",
                assignments: [
                  { slotId: "left", assetId: "asset_a", crop: null },
                  { slotId: "center", assetId: "asset_b", crop: null },
                  { slotId: "right", assetId: "asset_c", crop: null },
                ],
                backgroundColor: null,
              },
            ],
          };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.source, "ai");
  assert.equal(response.body.candidates[0].id, "provider_candidate");
});

test("generate-layout validates refine requests before calling the provider", async () => {
  const response = await handleGenerateLayoutRequestAsync(
    {
      ...requestBody,
      operation: "refine",
      intent: { ...requestBody.intent, mode: "ai", userPrompt: "Make it calmer" },
    },
    {
      provider: {
        async generatePlan() {
          throw new Error("Provider should not be called");
        },
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "invalid_request");
  assert.ok(
    response.body.issues.some((issue) => issue.path === "currentLayout"),
  );
});

test("generate-layout sends refine operation and current layout to provider", async () => {
  const generated = handleGenerateLayoutRequest(requestBody);
  const currentLayout = generated.body.candidates[0].layout;
  let capturedOperation = null;
  let capturedCurrentLayout = null;

  const response = await handleGenerateLayoutRequestAsync(
    {
      ...requestBody,
      operation: "refine",
      intent: {
        ...requestBody.intent,
        mode: "ai",
        userPrompt: "Make the center image the hero",
      },
      currentLayout,
      options: { candidateCount: 1, allowFallback: false },
    },
    {
      provider: {
        async generatePlan(input) {
          capturedOperation = input.operation;
          capturedCurrentLayout = input.request.currentLayout;
          return {
            candidates: [
              {
                id: "refined_candidate",
                label: "Refined triptych",
                reason: "The center slot now carries the strongest asset.",
                harmonyScore: 0.92,
                templateId: "triptych_desktop_equal",
                assignments: [
                  { slotId: "left", assetId: "asset_b", crop: null },
                  { slotId: "center", assetId: "asset_a", crop: null },
                  { slotId: "right", assetId: "asset_c", crop: null },
                ],
                backgroundColor: null,
              },
            ],
          };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.source, "ai");
  assert.equal(response.body.candidates.length, 1);
  assert.equal(capturedOperation, "refine");
  assert.deepEqual(capturedCurrentLayout, currentLayout);
});
