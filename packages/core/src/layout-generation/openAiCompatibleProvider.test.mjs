import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultCompositionBrief } from "./compositionBrief.ts";
import { loadLayoutModelConfig } from "./llmConfig.ts";
import {
  OpenAICompatibleLayoutProvider,
  classifyProviderError,
  extractJsonValue,
} from "./openAiCompatibleProvider.ts";
import { buildGeneratePlanningRequest } from "./planningProtocol.ts";

function analysis(assetId) {
  return {
    assetId,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 1920 / 1080,
    resolutionScore: 0.9,
    dominantColors: ["#456fd6", "#5278d8", "#3e64c0"],
    averageColor: "#456fd6",
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const legacyRequest = {
  operation: "generate",
  request: {
    operation: "generate",
    canvas: { width: 1920, height: 1080, ratioId: "16:9" },
    intent: {
      mode: "ai",
      style: "same-tone-triptych",
      count: 1,
    },
    assets: [analysis("asset_a"), analysis("asset_b"), analysis("asset_c")],
    options: { candidateCount: 1, allowFallback: true },
  },
};

const planningRequest = buildGeneratePlanningRequest(
  {
    ...createDefaultCompositionBrief({
      ratioId: "16:9",
      width: 1920,
      height: 1080,
      usage: "desktop",
    }),
    intent: {
      prompt: "A calm coastal wallpaper with the second image as hero",
      heroAssetId: "asset_b",
      hierarchy: "hero-support",
      density: "balanced",
      rhythm: "ordered",
      visualFlow: "left-to-right",
      moodTags: [],
    },
  },
  [analysis("asset_a"), analysis("asset_b"), analysis("asset_c")],
);

const plan = {
  candidates: [
    {
      id: "candidate_1",
      label: "Cool triptych",
      reason: "The images share a cool palette.",
      harmonyScore: 0.9,
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

function fakeClient(content, capture) {
  return {
    chat: {
      completions: {
        async create(body) {
          capture.body = body;
          return {
            choices: [{ message: { content, refusal: null } }],
          };
        },
      },
    },
  };
}

for (const responseFormat of ["json_schema", "json_object", "text"]) {
  test(`requests and parses ${responseFormat} model responses through the v2 planning protocol`, async () => {
    const capture = {};
    const provider = new OpenAICompatibleLayoutProvider(
      {
        apiKey: "test-key",
        baseURL: "https://example.test/v1",
        model: "test-model",
        responseFormat,
        timeoutMs: 5_000,
      },
      fakeClient(
        responseFormat === "text"
          ? `Layout result:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``
          : JSON.stringify(plan),
        capture,
      ),
    );

    const result = await provider.generatePlan(planningRequest);

    assert.equal(result.candidates[0].templateId, "triptych_desktop_equal");
    assert.equal(capture.body.model, "test-model");
    assert.equal(
      capture.body.messages[1].content.includes('"version":"2.0"'),
      true,
    );
    assert.equal(
      capture.body.messages[1].content.includes('"heroAssetId":"asset_b"'),
      true,
    );
    if (responseFormat === "text") {
      assert.equal(capture.body.response_format, undefined);
    } else {
      assert.equal(capture.body.response_format.type, responseFormat);
    }
  });
}

test("validates the v2 planning request before calling the model", async () => {
  const capture = {};
  const provider = new OpenAICompatibleLayoutProvider(
    {
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      model: "test-model",
      responseFormat: "json_object",
      timeoutMs: 5_000,
    },
    fakeClient(JSON.stringify(plan), capture),
  );

  await assert.rejects(
    () => provider.generatePlan({ ...planningRequest, version: "1.0" }),
    (error) => {
      assert.equal(error instanceof Error, true);
      return true;
    },
  );
  assert.equal(capture.body, undefined);
});

test("still serves the frozen legacy GenerateLayoutRequest prompt unchanged", async () => {
  const capture = {};
  const provider = new OpenAICompatibleLayoutProvider(
    {
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      model: "test-model",
      responseFormat: "json_object",
      timeoutMs: 5_000,
    },
    fakeClient(JSON.stringify(plan), capture),
  );

  const result = await provider.generateLegacyPlan(legacyRequest);
  const legacyPayload = JSON.parse(capture.body.messages[1].content);

  assert.equal(result.candidates[0].templateId, "triptych_desktop_equal");
  assert.deepEqual(legacyPayload.canvas, legacyRequest.request.canvas);
  assert.equal(legacyPayload.style, "same-tone-triptych");
  assert.equal(legacyPayload.version, undefined);
  assert.equal("brief" in legacyPayload, false);
});

test("loads neutral LLM environment configuration", () => {
  assert.deepEqual(
    loadLayoutModelConfig({
      LLM_API_KEY: "key",
      LLM_BASE_URL: "https://provider.test/v1",
      LLM_MODEL: "provider-model",
      LLM_RESPONSE_FORMAT: "json_schema",
      LLM_TIMEOUT_MS: "45000",
    }),
    {
      apiKey: "key",
      baseURL: "https://provider.test/v1",
      model: "provider-model",
      responseFormat: "json_schema",
      timeoutMs: 45_000,
    },
  );
});

test("extracts the first JSON value from model prose", () => {
  assert.deepEqual(
    extractJsonValue(`Result follows: ${JSON.stringify(plan)} trailing text`),
    plan,
  );
});

test("classifies common OpenAI-compatible provider failures", () => {
  assert.equal(classifyProviderError({ status: 401 }).code, "authentication");
  assert.equal(classifyProviderError({ status: 429 }).code, "rate_limit");
  assert.equal(classifyProviderError({ status: 503 }).code, "provider_error");
  assert.equal(classifyProviderError({ name: "AbortError" }).code, "timeout");
});
