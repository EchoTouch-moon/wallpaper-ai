import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultCompositionBrief } from "./compositionBrief.ts";
import {
  loadLayoutModelConfig,
  loadVisionPlanningConfig,
} from "./llmConfig.ts";
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

const visionConfig = {
  apiKey: "vision-key",
  baseURL: "https://vision.test/v1",
  model: "vision-model",
  timeoutMs: 20_000,
};

function imageParts(content) {
  return content.filter((part) => part.type === "image_url");
}

test("assembles one annotated image part per asset when vision planning is enabled", async () => {
  const capture = {};
  const provider = new OpenAICompatibleLayoutProvider(
    {
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      model: "test-model",
      responseFormat: "json_object",
      timeoutMs: 5_000,
      visionPlanning: visionConfig,
    },
    fakeClient(JSON.stringify(plan), capture),
  );

  const result = await provider.generatePlan({
    ...planningRequest,
    assetContent,
  });

  assert.equal(result.candidates[0].templateId, "triptych_desktop_equal");
  const content = capture.body.messages[1].content;
  assert.equal(Array.isArray(content), true);
  // One image_url part per assetContent entry, carrying the exact dataUrl.
  assert.deepEqual(
    imageParts(content).map((part) => part.image_url.url),
    assetContent.map((asset) => asset.dataUrl),
  );
  assert.equal(imageParts(content).length, 2);
  // Each image is preceded by a text label naming its assetId.
  const labelParts = content.filter(
    (part) => part.type === "text" && part.text.includes("assetId:"),
  );
  assert.deepEqual(
    labelParts.map((part) => part.text),
    [
      "Asset 1 of 2; assetId: asset_a",
      "Asset 2 of 2; assetId: asset_c",
    ],
  );
  // The authoritative planning payload travels as the final text part.
  const payloadPart = content.at(-1);
  assert.equal(payloadPart.type, "text");
  assert.equal(payloadPart.text.includes('"version":"2.0"'), true);
  assert.equal(payloadPart.text.includes('"heroAssetId":"asset_b"'), true);
  // The multimodal call targets the VISION_* model identity.
  assert.equal(capture.body.model, "vision-model");
  assert.equal(capture.body.response_format.type, "json_object");
});

test("keeps the text-only message when the vision planning gate is off", async () => {
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

  await provider.generatePlan({ ...planningRequest, assetContent });

  assert.equal(typeof capture.body.messages[1].content, "string");
  assert.equal(capture.body.messages[1].content.includes('"version":"2.0"'), true);
  assert.equal(capture.body.model, "test-model");
});

test("keeps the text-only message when no vision model is configured", async () => {
  const capture = {};
  // Gate resolved to null (no key): no visionPlanning field on the config.
  assert.equal(loadVisionPlanningConfig({ VISION_PLANNING_ENABLED: "true" }), null);
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

  await provider.generatePlan(planningRequest);

  assert.equal(typeof capture.body.messages[1].content, "string");
  assert.equal(capture.body.model, "test-model");
});

test("keeps the text-only message when the request carries no asset content", async () => {
  const capture = {};
  const provider = new OpenAICompatibleLayoutProvider(
    {
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      model: "test-model",
      responseFormat: "json_object",
      timeoutMs: 5_000,
      visionPlanning: visionConfig,
    },
    fakeClient(JSON.stringify(plan), capture),
  );

  await provider.generatePlan(planningRequest);

  assert.equal(typeof capture.body.messages[1].content, "string");
  assert.equal(capture.body.model, "test-model");
});

test("resolves the vision planning configuration from the environment", () => {
  // Gate defaults to off.
  assert.equal(loadVisionPlanningConfig({}), null);
  assert.equal(
    loadVisionPlanningConfig({ VISION_PLANNING_ENABLED: "false" }),
    null,
  );
  // Gate on without any usable key or model degrades to null.
  assert.equal(
    loadVisionPlanningConfig({ VISION_PLANNING_ENABLED: "true" }),
    null,
  );
  assert.equal(
    loadVisionPlanningConfig({
      VISION_PLANNING_ENABLED: "true",
      LLM_API_KEY: "key",
    }),
    null,
  );
  // Falls back to the main LLM configuration when VISION_* is unset.
  assert.deepEqual(
    loadVisionPlanningConfig({
      VISION_PLANNING_ENABLED: "true",
      LLM_API_KEY: "main-key",
      LLM_BASE_URL: "https://main.test/v1",
      LLM_MODEL: "main-model",
    }),
    {
      apiKey: "main-key",
      baseURL: "https://main.test/v1",
      model: "main-model",
      timeoutMs: 20_000,
    },
  );
  // VISION_* overrides win over the main configuration.
  assert.deepEqual(
    loadVisionPlanningConfig({
      VISION_PLANNING_ENABLED: "true",
      LLM_API_KEY: "main-key",
      LLM_BASE_URL: "https://main.test/v1",
      LLM_MODEL: "main-model",
      VISION_API_KEY: "vision-key",
      VISION_BASE_URL: "https://vision.test/v1",
      VISION_MODEL: "vision-model",
      VISION_TIMEOUT_MS: "45000",
    }),
    {
      apiKey: "vision-key",
      baseURL: "https://vision.test/v1",
      model: "vision-model",
      timeoutMs: 45_000,
    },
  );
});

test("attaches the vision planning configuration only when the gate resolves", () => {
  assert.equal(
    "visionPlanning" in loadLayoutModelConfig({
      LLM_API_KEY: "key",
      LLM_MODEL: "model",
    }),
    false,
  );
  assert.deepEqual(
    loadLayoutModelConfig({
      LLM_API_KEY: "key",
      LLM_MODEL: "model",
      VISION_PLANNING_ENABLED: "true",
      VISION_MODEL: "vision-model",
    }).visionPlanning,
    {
      apiKey: "key",
      baseURL: "https://api.openai.com/v1",
      model: "vision-model",
      timeoutMs: 20_000,
    },
  );
});
