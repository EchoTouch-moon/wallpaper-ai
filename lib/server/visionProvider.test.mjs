import assert from "node:assert/strict";
import test from "node:test";

import {
  createVisionProviderFromEnvironment,
  mergeVisionAnalysis,
  OpenAICompatibleVisionProvider,
} from "./visionProvider.ts";

const patch = {
  contentType: "portrait",
  faces: [{ x: 0.35, y: 0.1, width: 0.2, height: 0.25 }],
  subjectBox: { x: 0.2, y: 0.05, width: 0.6, height: 0.9 },
  saliencyCenter: { x: 0.5, y: 0.42 },
  styleTags: ["soft", "editorial"],
  bestUse: ["hero", "portrait-collage"],
  cropSafety: "low",
};

const basicAnalysis = {
  assetId: "asset",
  width: 1200,
  height: 1800,
  orientation: "portrait",
  aspectRatio: 2 / 3,
  resolutionScore: 0.8,
  dominantColors: ["#112233", "#223344", "#334455"],
  averageColor: "#223344",
  brightness: 0.4,
  saturation: 0.5,
  contrast: 0.3,
};

test("requests structured semantic analysis from an OpenAI-compatible client", async () => {
  const capture = {};
  const provider = new OpenAICompatibleVisionProvider(
    {
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      model: "vision-model",
      timeoutMs: 5_000,
    },
    {
      chat: {
        completions: {
          async create(body) {
            capture.body = body;
            return {
              choices: [
                { message: { content: JSON.stringify(patch), refusal: null } },
              ],
            };
          },
        },
      },
    },
  );

  const result = await provider.analyze({
    buffer: Buffer.from("preview"),
    mimeType: "image/jpeg",
    width: 1200,
    height: 1800,
    basicAnalysis,
  });

  assert.deepEqual(result, patch);
  assert.equal(capture.body.model, "vision-model");
  assert.equal(capture.body.response_format.type, "json_schema");
  assert.match(
    capture.body.messages[1].content[1].image_url.url,
    /^data:image\/jpeg;base64,/,
  );
});

test("keeps pixel analysis while merging semantic fields", () => {
  const merged = mergeVisionAnalysis(basicAnalysis, patch);

  assert.equal(merged.averageColor, "#223344");
  assert.equal(merged.contentType, "portrait");
  assert.equal(merged.faces.length, 1);
  assert.equal(merged.subjectBox.height, 0.9);
});

test("requires explicit vision opt-in and model configuration", () => {
  assert.equal(createVisionProviderFromEnvironment({}), null);
  assert.equal(
    createVisionProviderFromEnvironment({
      VISION_ENABLED: "true",
      LLM_API_KEY: "key",
    }),
    null,
  );
  assert.ok(
    createVisionProviderFromEnvironment({
      VISION_ENABLED: "true",
      LLM_API_KEY: "key",
      VISION_MODEL: "vision-model",
    }),
  );
});
