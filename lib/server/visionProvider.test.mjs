import assert from "node:assert/strict";
import test from "node:test";

import {
  createVisionProviderFromEnvironment,
  mergeVisionAnalysis,
  OpenAICompatibleVisionProvider,
} from "./visionProvider.ts";

// Semantic-only patch: geometry (faces/subjectBox/subjectContour) belongs to
// the local ONNX layer, so the VLM result never carries it.
const patch = {
  contentType: "portrait",
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

const SALIENT_SUBJECT_RETRY_SENTENCE =
  "You must output the single most salient subject box even if uncertain\\.";

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
    height: 1440,
    basicAnalysis,
  });

  assert.deepEqual(result, { ...patch, analysisWarnings: [] });
  assert.equal(capture.body.model, "vision-model");
  assert.equal(capture.body.response_format.type, "json_schema");
  assert.match(
    capture.body.messages[1].content[1].image_url.url,
    /^data:image\/jpeg;base64,/,
  );
  // The text prompt spells out the semantic object contract for relays that
  // ignore response_format.
  assert.match(
    capture.body.messages[1].content[0].text,
    /Answer with a single JSON object \(never an array\)/,
  );
  assert.doesNotMatch(
    capture.body.messages[1].content[0].text,
    /salient subject box/,
  );
});

test("adopts a full object response directly, including styleTags up to 8", async () => {
  const fullObject = {
    contentType: "anime",
    saliencyCenter: { x: 0.35, y: 0.5 },
    styleTags: [
      "anime",
      "soft-light",
      "pastel",
      "character-art",
      "clean-lines",
      "vivid",
      "splash",
      "cool-tone",
    ],
    bestUse: ["hero", "background", "triptych"],
    cropSafety: "medium",
  };
  const provider = providerReturning(JSON.stringify(fullObject));

  const result = await provider.analyze(visionInput);

  // Object shape hits -> every field is taken verbatim, no derivation.
  assert.deepEqual(result, { ...fullObject, analysisWarnings: [] });
  assert.equal(result.styleTags.length, 8);
  assert.equal(result.analysisWarnings.length, 0);
});

test("parses a semantic-only object without saliencyCenter or any geometry", async () => {
  const result = await providerReturning(
    JSON.stringify({
      contentType: "architecture",
      styleTags: ["minimal", "concrete"],
      bestUse: ["background"],
      cropSafety: "high",
    }),
  ).analyze(visionInput);

  // Missing geometry is not an unavailability signal: the four semantic
  // fields alone form a complete patch, saliencyCenter stays absent.
  assert.equal(result.contentType, "architecture");
  assert.deepEqual(result.styleTags, ["minimal", "concrete"]);
  assert.deepEqual(result.bestUse, ["background"]);
  assert.equal(result.cropSafety, "high");
  assert.equal("saliencyCenter" in result, false);
  assert.deepEqual(result.analysisWarnings, []);
});

test("keeps pixel analysis while merging semantic fields", () => {
  const merged = mergeVisionAnalysis(basicAnalysis, patch);

  assert.equal(merged.averageColor, "#223344");
  assert.equal(merged.contentType, "portrait");
  assert.deepEqual(merged.styleTags, ["soft", "editorial"]);
  assert.deepEqual(merged.bestUse, ["hero", "portrait-collage"]);
  assert.equal(merged.cropSafety, "low");
  assert.deepEqual(merged.saliencyCenter, { x: 0.5, y: 0.42 });
});

test("mergeVisionAnalysis strips the provider analysisWarnings channel", () => {
  const merged = mergeVisionAnalysis(basicAnalysis, {
    ...patch,
    analysisWarnings: ["Vision detection array had no usable box_2d entries"],
  });

  assert.equal(merged.contentType, "portrait");
  assert.equal("analysisWarnings" in merged, false);
});

test("fills saliencyCenter only when the analysis has none; a present value wins", () => {
  const gapless = mergeVisionAnalysis(basicAnalysis, {
    ...patch,
    saliencyCenter: { x: 0.4, y: 0.4 },
  });
  assert.deepEqual(gapless.saliencyCenter, { x: 0.4, y: 0.4 });

  // A saliencyCenter already on the analysis (the local vision layer's mask
  // centroid) is geometry-owned and must not be overridden by the VLM.
  const withLocal = mergeVisionAnalysis(
    { ...basicAnalysis, saliencyCenter: { x: 0.5, y: 0.4 } },
    { ...patch, saliencyCenter: { x: 0.9, y: 0.1 } },
  );
  assert.deepEqual(withLocal.saliencyCenter, { x: 0.5, y: 0.4 });
});

function providerReturning(content) {
  return providerReturningSequence([content]).provider;
}

// Returns the given contents in order (repeating the last one if the provider
// asks for more calls than provided) and records every request body.
function providerReturningSequence(contents) {
  const calls = [];
  let index = 0;
  return {
    calls,
    provider: new OpenAICompatibleVisionProvider(
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
              calls.push(body);
              const content = contents[Math.min(index, contents.length - 1)];
              index += 1;
              return { choices: [{ message: { content, refusal: null } }] };
            },
          },
        },
      },
    ),
  };
}

const visionInput = {
  buffer: Buffer.from("preview"),
  mimeType: "image/jpeg",
  width: 1200,
  height: 1440,
  basicAnalysis,
};

// Real relay shape: glm-5v-turbo ignores response_format json_schema and
// answers with a native detection array of box_2d entries.
test("maps a top-level box_2d detection array onto semantic fields only", async () => {
  const provider = providerReturning(
    JSON.stringify([
      { box_2d: [0.05, 0.02, 0.97, 0.98], label: "background" },
      { box_2d: [0.27, 0, 0.85, 0.9], label: "foreground_subject" },
    ]),
  );

  const result = await provider.analyze(visionInput);

  // The mapped subject box survives only as the saliencyCenter fallback
  // point; faces/subjectBox themselves are local-layer geometry.
  assert.equal("faces" in result, false);
  assert.equal("subjectBox" in result, false);
  assert.ok(
    Math.abs(result.saliencyCenter.x - (0.27 + 0.58 / 2)) < 1e-9,
  );
  assert.ok(Math.abs(result.saliencyCenter.y - 0.45) < 1e-9);
  // 0.58/0.9 aspect ~0.64 -> vertical subject box derives contentType
  // "portrait", which also folds into bestUse and cropSafety.
  assert.equal(result.contentType, "portrait");
  assert.deepEqual(result.styleTags, []);
  assert.deepEqual(result.bestUse, ["hero", "background", "portrait-collage"]);
  assert.equal(result.cropSafety, "low");
  assert.deepEqual(result.analysisWarnings, []);
});

test("derives contentType from the detection array shape", async () => {
  // Wide box spanning most of the frame width -> landscape scenery.
  const landscape = await providerReturning(
    JSON.stringify([
      { box_2d: [0.05, 0.3, 0.95, 0.75], label: "foreground_subject" },
    ]),
  ).analyze(visionInput);
  assert.equal(landscape.contentType, "landscape");
  assert.deepEqual(landscape.bestUse, ["hero", "background"]);
  assert.equal(landscape.cropSafety, "medium");
  assert.ok(Math.abs(landscape.saliencyCenter.x - 0.5) < 1e-9);
  assert.ok(Math.abs(landscape.saliencyCenter.y - 0.525) < 1e-9);

  // Wide but partial-span box -> discrete object.
  const object = await providerReturning(
    JSON.stringify([
      { box_2d: [0.3, 0.4, 0.7, 0.6], label: "foreground_subject" },
    ]),
  ).analyze(visionInput);
  assert.equal(object.contentType, "object");
  assert.equal(object.cropSafety, "medium");

  // Near-square box (0.9 <= aspect <= 1.1) stays unknown.
  const square = await providerReturning(
    JSON.stringify([
      { box_2d: [0.2, 0.2, 0.8, 0.8], label: "foreground_subject" },
    ]),
  ).analyze(visionInput);
  assert.equal(square.contentType, "unknown");
  assert.equal(square.cropSafety, "medium");

  // A labelled face wins even when the subject box is horizontal.
  const withFace = await providerReturning(
    JSON.stringify([
      { box_2d: [0.05, 0.3, 0.95, 0.75], label: "foreground_subject" },
      { box_2d: [0.4, 0.35, 0.5, 0.55], label: "face" },
    ]),
  ).analyze(visionInput);
  assert.equal(withFace.contentType, "portrait");
  assert.equal(withFace.cropSafety, "low");

  // No subject box and no face -> unknown with background-only use and no
  // saliencyCenter at all (nothing to point at).
  const bare = await providerReturning(
    JSON.stringify([{ box_2d: [0, 0, 1, 1], label: "background" }]),
  ).analyze(visionInput);
  assert.equal(bare.contentType, "unknown");
  assert.equal("subjectBox" in bare, false);
  assert.equal("saliencyCenter" in bare, false);
  assert.deepEqual(bare.bestUse, ["background"]);
  assert.equal(bare.cropSafety, "medium");
});

test("detection-array faces inform derivations but never enter the patch", async () => {
  const detections = [
    // Subject candidates: the largest subject-labelled box wins.
    { box_2d: [0.1, 0.1, 0.3, 0.3], label: "subject_secondary" },
    { box_2d: [-0.2, 0.05, 1.3, 1.1], label: "foreground_subject" },
    // Face/person boxes drive the portrait/low derivations.
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

  // foreground_subject clamps from [-0.2, 0.05, 1.3, 1.1] to the unit box
  // {x:0, y:0.05, width:1, height:0.95}, whose center becomes the
  // saliencyCenter fallback.
  assert.ok(Math.abs(result.saliencyCenter.x - 0.5) < 1e-9);
  assert.ok(Math.abs(result.saliencyCenter.y - 0.525) < 1e-9);
  assert.equal("faces" in result, false);
  assert.equal("subjectBox" in result, false);
  // Faces present -> portrait wins over the near-square subject box.
  assert.equal(result.contentType, "portrait");
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

  assert.ok(Math.abs(result.saliencyCenter.x - 0.4) < 1e-9);
  assert.ok(Math.abs(result.saliencyCenter.y - 0.45) < 1e-9);
});

test("a valid patch object keeps the existing object path untouched", async () => {
  const provider = providerReturning(
    `Sure, here is the analysis: ${JSON.stringify(patch)} (end)`,
  );

  const result = await provider.analyze(visionInput);

  assert.deepEqual(result, { ...patch, analysisWarnings: [] });
});

test("retries once with an explicit subject-box demand when the detection array is empty", async () => {
  const { provider, calls } = providerReturningSequence([
    "[]",
    JSON.stringify([
      { box_2d: [0.3, 0.1, 0.7, 0.9], label: "foreground_subject" },
    ]),
  ]);

  const result = await provider.analyze(visionInput);

  // Exactly one retry, and the retry request carries the extra sentence.
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0].messages[1].content[0].text, /salient subject/);
  assert.match(
    calls[1].messages[1].content[0].text,
    new RegExp(SALIENT_SUBJECT_RETRY_SENTENCE),
  );
  // The patch comes from the retry response (0.4/0.8 vertical box ->
  // portrait semantics with the box center as saliencyCenter).
  assert.equal(result.contentType, "portrait");
  assert.deepEqual(result.saliencyCenter, { x: 0.5, y: 0.5 });
  // The successful retry stays observable through analysisWarnings.
  assert.equal(result.analysisWarnings.length, 1);
  assert.match(result.analysisWarnings[0], /retried once/);
  assert.match(result.analysisWarnings[0], /box_2d/);
});

test("degrades with an explicit message when the retry still returns no usable entries", async () => {
  const { provider, calls } = providerReturningSequence(["[]"]);

  await assert.rejects(
    () => provider.analyze(visionInput),
    /array without usable box_2d detection entries after one retry/,
  );
  // One initial call plus exactly one retry, then degradation.
  assert.equal(calls.length, 2);
  assert.match(
    calls[1].messages[1].content[0].text,
    new RegExp(SALIENT_SUBJECT_RETRY_SENTENCE),
  );
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
    /array without usable box_2d detection entries after one retry/,
  );
  await assert.rejects(
    () => providerReturning('{"unexpected": "shape"}').analyze(visionInput),
    /object without usable semantic fields/,
  );
});

test("salvages drifted object shapes: bare coordinate arrays, free-form enums, comma-joined styleTags", async () => {
  const result = await providerReturning(
    JSON.stringify({
      contentType: "Scenery",
      saliencyCenter: [0.56, 0.45],
      subjectBox: [0.27, -0.05, 0.85, 0.9],
      styleTags: "aurora, fantasy illustration; vibrant",
      bestUse: ["hero", "background", "mood-board"],
      cropSafety: "very-high",
    }),
  ).analyze(visionInput);

  // Drifted saliencyCenter array is coerced; the drifted subjectBox only
  // feeds the conservative derivations (0.58/0.9 -> portrait) and never
  // enters the patch.
  assert.deepEqual(result.saliencyCenter, { x: 0.56, y: 0.45 });
  assert.equal("subjectBox" in result, false);
  assert.equal(result.contentType, "portrait");
  assert.deepEqual(result.styleTags, [
    "aurora",
    "fantasy illustration",
    "vibrant",
  ]);
  assert.deepEqual(result.bestUse, ["hero", "background"]);
  assert.equal(result.cropSafety, "low");
});

test("keeps a fully valid object patch byte-identical through normalization", async () => {
  const valid = {
    contentType: "portrait",
    saliencyCenter: { x: 0.35, y: 0.475 },
    styleTags: ["cat", "close-up"],
    bestUse: ["hero"],
    cropSafety: "low",
  };
  const result = await providerReturning(JSON.stringify(valid)).analyze(
    visionInput,
  );
  const { analysisWarnings, ...parsed } = result;
  assert.deepEqual(analysisWarnings, []);
  assert.deepEqual(parsed, valid);
});

test("ignores geometry drift fields in object responses", async () => {
  const result = await providerReturning(
    JSON.stringify({
      contentType: "pet",
      faces: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.2 }],
      subjectBox: { x: 0.05, y: 0, width: 0.6, height: 0.95 },
      subjectContour: {
        grid: "1".repeat(576),
        gridSize: 24,
        subjectAreaRatio: 1,
      },
      saliencyCenter: { x: 0.5, y: 0.5 },
      styleTags: ["cat"],
      bestUse: ["hero"],
      cropSafety: "low",
    }),
  ).analyze(visionInput);

  // Geometry from the VLM (model still answering the old prompt) is dropped
  // silently: the local layer owns it, and dropping is not a warning-worthy
  // degradation.
  assert.equal("faces" in result, false);
  assert.equal("subjectBox" in result, false);
  assert.equal("subjectContour" in result, false);
  assert.deepEqual(result.analysisWarnings, []);
  assert.equal(result.contentType, "pet");
  assert.deepEqual(result.saliencyCenter, { x: 0.5, y: 0.5 });
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

test("omits geometry fields from the response schema and prompt", async () => {
  const { provider, calls } = providerReturningSequence([
    JSON.stringify(patch),
  ]);
  await provider.analyze(visionInput);

  const schema = calls[0].response_format.json_schema.schema;
  assert.deepEqual(
    [...schema.required].sort(),
    ["contentType", "saliencyCenter", "styleTags", "bestUse", "cropSafety"].sort(),
  );
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    ["contentType", "saliencyCenter", "styleTags", "bestUse", "cropSafety"].sort(),
  );
  // Optional saliencyCenter is expressed as anyOf + null for strict mode.
  assert.deepEqual(schema.properties.saliencyCenter.anyOf[1], { type: "null" });

  const prompt = calls[0].messages[1].content[0].text;
  assert.match(prompt, /contentType/);
  assert.match(prompt, /styleTags/);
  assert.match(prompt, /bestUse/);
  assert.match(prompt, /cropSafety/);
  assert.match(prompt, /saliencyCenter/);
  // The heavyweight geometry contract is gone from the prompt entirely.
  assert.doesNotMatch(prompt, /subjectContour/);
  assert.doesNotMatch(prompt, /576/);
  assert.doesNotMatch(prompt, /face\/head/);
  assert.doesNotMatch(prompt, /subjectBox/);
});

test("uses drifted faces only as a derivation signal when semantics are missing", async () => {
  // No contentType/cropSafety: the drifted face boxes (both valid shapes
  // survive, the inverted and zero-area ones drop) derive portrait + low.
  const result = await providerReturning(
    JSON.stringify({
      faces: [
        [0.1, 0.1, 0.3, 0.3],
        { x: 0.5, y: 0.55, width: 0.2, height: 0.2 },
        [0.9, 0.1, 0.7, 0.2], // inverted corners -> zero width -> dropped
        { x: 0.1, y: 0.1, width: 0, height: 0.2 }, // zero area -> dropped
      ],
      styleTags: ["candid"],
    }),
  ).analyze(visionInput);

  assert.equal("faces" in result, false);
  assert.equal(result.contentType, "portrait");
  assert.equal(result.cropSafety, "low");
  assert.deepEqual(result.styleTags, ["candid"]);
  // No subjectBox and no explicit saliencyCenter -> nothing to point at.
  assert.equal("saliencyCenter" in result, false);
  assert.deepEqual(result.analysisWarnings, []);
});

test("downsizes large originals before calling the vision model", async () => {
  const sharp = (await import("sharp")).default;
  const bigImage = await sharp({
    create: { width: 2000, height: 4000, channels: 3, background: "#336699" },
  })
    .jpeg()
    .toBuffer();
  const validPatch = {
    contentType: "portrait",
    saliencyCenter: { x: 0.5, y: 0.5 },
    styleTags: ["test"],
    bestUse: ["hero"],
    cropSafety: "medium",
  };
  const harness = providerReturningSequence([JSON.stringify(validPatch)]);
  await harness.provider.analyze({
    ...visionInput,
    buffer: bigImage,
    width: 2000,
    height: 4000,
  });
  assert.equal(harness.calls.length, 1);
  const url = harness.calls[0].messages[1].content[1].image_url.url;
  assert.equal(url.startsWith("data:image/jpeg;base64,"), true);
  const decoded = await sharp(
    Buffer.from(url.slice("data:image/jpeg;base64,".length), "base64"),
  ).metadata();
  assert.equal(Math.max(decoded.width, decoded.height) <= 1536, true);
  assert.equal(Math.min(decoded.width, decoded.height) > 0, true);
});

test("sends small originals through unchanged", async () => {
  const sharp = (await import("sharp")).default;
  const smallImage = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#669933" },
  })
    .jpeg()
    .toBuffer();
  const validPatch = {
    contentType: "landscape",
    saliencyCenter: null,
    styleTags: [],
    bestUse: ["background"],
    cropSafety: "high",
  };
  const harness = providerReturningSequence([JSON.stringify(validPatch)]);
  await harness.provider.analyze({
    ...visionInput,
    buffer: smallImage,
    mimeType: "image/jpeg",
    width: 800,
    height: 600,
  });
  const url = harness.calls[0].messages[1].content[1].image_url.url;
  const decoded = await sharp(
    Buffer.from(url.slice("data:image/jpeg;base64,".length), "base64"),
  ).metadata();
  assert.equal(decoded.width, 800);
  assert.equal(decoded.height, 600);
});
