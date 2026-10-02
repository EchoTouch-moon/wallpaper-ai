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

function providerReturning(content) {
  return new OpenAICompatibleVisionProvider(
    {
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      model: "vision-model",
      timeoutMs: 5_000,
    },
    {
      chat: {
        completions: {
          async create() {
            return { choices: [{ message: { content, refusal: null } }] };
          },
        },
      },
    },
  );
}

const visionInput = {
  buffer: Buffer.from("preview"),
  mimeType: "image/jpeg",
  width: 1200,
  height: 1800,
  basicAnalysis,
};

// Real relay shape: glm-5v-turbo ignores response_format json_schema and
// answers with a native detection array of box_2d entries.
test("maps a top-level box_2d detection array onto the vision patch", async () => {
  const provider = providerReturning(
    JSON.stringify([
      { box_2d: [0.05, 0.02, 0.97, 0.98], label: "background" },
      { box_2d: [0.27, 0, 0.85, 0.9], label: "foreground_subject" },
    ]),
  );

  const result = await provider.analyze(visionInput);

  assert.deepEqual(result.subjectBox, {
    x: 0.27,
    y: 0,
    width: 0.85 - 0.27,
    height: 0.9,
  });
  assert.deepEqual(result.faces, []);
  assert.equal(result.contentType, "unknown");
  assert.deepEqual(result.styleTags, []);
  assert.deepEqual(result.bestUse, ["hero", "background"]);
  assert.equal(result.cropSafety, "medium");
  assert.ok(
    Math.abs(result.saliencyCenter.x - (0.27 + 0.58 / 2)) < 1e-9,
  );
  assert.ok(Math.abs(result.saliencyCenter.y - 0.45) < 1e-9);
});

test("detection array maps faces, clamps out-of-range boxes, and caps faces at 12", async () => {
  const detections = [
    // Subject candidates: the largest subject-labelled box wins.
    { box_2d: [0.1, 0.1, 0.3, 0.3], label: "subject_secondary" },
    { box_2d: [-0.2, 0.05, 1.3, 1.1], label: "foreground_subject" },
    // Face/person boxes land in faces, largest first.
    { box_2d: [0.5, 0.4, 0.7, 0.6], label: "face" },
    { box_2d: [0.8, 0.1, 0.9, 0.2], label: "person" },
  ];
  for (let index = 0; index < 14; index += 1) {
    detections.push({
      box_2d: [0.01, 0.01, 0.02, 0.02],
      label: `face_extra_${index}`,
    });
  }
  const provider = providerReturning(JSON.stringify(detections));

  const result = await provider.analyze(visionInput);

  // foreground_subject clamps from [-0.2, 0.05, 1.3, 1.1] to the unit box.
  assert.deepEqual(result.subjectBox, {
    x: 0,
    y: 0.05,
    width: 1,
    height: 0.95,
  });
  assert.equal(result.faces.length, 12);
  assert.deepEqual(result.faces[0], {
    x: 0.5,
    y: 0.4,
    width: 0.7 - 0.5,
    height: 0.6 - 0.4,
  });
  assert.deepEqual(result.faces[1], {
    x: 0.8,
    y: 0.1,
    width: 0.9 - 0.8,
    height: 0.2 - 0.1,
  });
  // The tiny 0.01-sized extra faces fill the remaining slots.
  assert.deepEqual(result.faces[2], {
    x: 0.01,
    y: 0.01,
    width: 0.01,
    height: 0.01,
  });
  assert.equal(result.cropSafety, "low");
});

test("a fenced detection array is extracted the same way", async () => {
  const provider = providerReturning(
    "```json\n" +
      JSON.stringify([
        { box_2d: [0.2, 0.1, 0.6, 0.8], label: "background" },
        { box_2d: [0.25, 0.15, 0.55, 0.75], label: "foreground_subject" },
      ]) +
      "\n```",
  );

  const result = await provider.analyze(visionInput);

  assert.deepEqual(result.subjectBox, {
    x: 0.25,
    y: 0.15,
    width: 0.55 - 0.25,
    height: 0.75 - 0.15,
  });
});

test("a valid patch object keeps the existing object path untouched", async () => {
  const provider = providerReturning(
    `Sure, here is the analysis: ${JSON.stringify(patch)} (end)`,
  );

  const result = await provider.analyze(visionInput);

  assert.deepEqual(result, patch);
});

test("rejects payloads that are neither a patch object nor a detection array", async () => {
  await assert.rejects(
    () => providerReturning("The image shows a mountain.").analyze(visionInput),
    /no JSON object or detection array/,
  );
  await assert.rejects(
    () => providerReturning('[{"box_2d": [0.1,}]').analyze(visionInput),
    /unparseable JSON/,
  );
  await assert.rejects(
    () => providerReturning('[{"foo": 1}, {"bar": 2}]').analyze(visionInput),
    /array without usable box_2d detection entries/,
  );
  await assert.rejects(
    () => providerReturning('{"unexpected": "shape"}').analyze(visionInput),
    (error) =>
      error instanceof Error &&
      error.name === "ZodError" &&
      error.message.includes("contentType"),
  );
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
