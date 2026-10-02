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
  // The text prompt spells out the full-object contract for relays that
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
    faces: [],
    subjectBox: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
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

test("keeps pixel analysis while merging semantic fields", () => {
  const merged = mergeVisionAnalysis(basicAnalysis, patch);

  assert.equal(merged.averageColor, "#223344");
  assert.equal(merged.contentType, "portrait");
  assert.equal(merged.faces.length, 1);
  assert.equal(merged.subjectBox.height, 0.9);
});

test("mergeVisionAnalysis strips the provider analysisWarnings channel", () => {
  const merged = mergeVisionAnalysis(basicAnalysis, {
    ...patch,
    analysisWarnings: ["Vision detection array had no usable box_2d entries"],
  });

  assert.equal(merged.contentType, "portrait");
  assert.equal("analysisWarnings" in merged, false);
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
  // 0.58/0.9 aspect ~0.64 -> vertical subject box derives contentType
  // "portrait", which also folds into bestUse and cropSafety.
  assert.equal(result.contentType, "portrait");
  assert.deepEqual(result.styleTags, []);
  assert.deepEqual(result.bestUse, ["hero", "background", "portrait-collage"]);
  assert.equal(result.cropSafety, "low");
  assert.deepEqual(result.analysisWarnings, []);
  assert.ok(
    Math.abs(result.saliencyCenter.x - (0.27 + 0.58 / 2)) < 1e-9,
  );
  assert.ok(Math.abs(result.saliencyCenter.y - 0.45) < 1e-9);
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

  // No subject box and no face -> unknown with background-only use.
  const bare = await providerReturning(
    JSON.stringify([{ box_2d: [0, 0, 1, 1], label: "background" }]),
  ).analyze(visionInput);
  assert.equal(bare.contentType, "unknown");
  assert.equal(bare.subjectBox, null);
  assert.deepEqual(bare.bestUse, ["background"]);
  assert.equal(bare.cropSafety, "medium");
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
  // The patch comes from the retry response.
  assert.equal(result.subjectBox.x, 0.3);
  assert.equal(result.subjectBox.y, 0.1);
  assert.ok(Math.abs(result.subjectBox.width - 0.4) < 1e-9);
  assert.ok(Math.abs(result.subjectBox.height - 0.8) < 1e-9);
  assert.equal(result.contentType, "portrait");
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
      faces: [],
      subjectBox: [0.27, -0.05, 0.85, 0.9],
      saliencyCenter: [0.56, 0.45],
      styleTags: "aurora, fantasy illustration; vibrant",
      bestUse: ["hero", "background", "mood-board"],
      cropSafety: "very-high",
    }),
  ).analyze(visionInput);

  assert.deepEqual(result.subjectBox, { x: 0.27, y: 0, width: 0.58, height: 0.9 });
  assert.deepEqual(result.saliencyCenter, { x: 0.56, y: 0.45 });
  assert.equal(result.contentType, "portrait");
  assert.deepEqual(result.styleTags, [
    "aurora",
    "fantasy illustration",
    "vibrant",
  ]);
  assert.deepEqual(result.bestUse, ["hero", "background"]);
});

test("keeps a fully valid object patch byte-identical through normalization", async () => {
  const valid = {
    contentType: "portrait",
    faces: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.2 }],
    subjectBox: { x: 0.05, y: 0, width: 0.6, height: 0.95 },
    saliencyCenter: { x: 0.35, y: 0.475 },
    styleTags: ["cat", "close-up"],
    bestUse: ["hero"],
    cropSafety: "low",
  };
  const result = await providerReturning(JSON.stringify(valid)).analyze(
    visionInput,
  );
  const { analysisWarnings, ...patch } = result;
  assert.deepEqual(analysisWarnings, []);
  assert.deepEqual(patch, valid);
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

test("requests the face and contour fields in the response schema and prompt", async () => {
  const { provider, calls } = providerReturningSequence([
    JSON.stringify(patch),
  ]);
  await provider.analyze(visionInput);

  const schema = calls[0].response_format.json_schema.schema;
  assert.ok(schema.required.includes("faces"));
  assert.equal(schema.properties.faces.maxItems, 12);
  assert.ok(schema.required.includes("subjectContour"));
  const contour = schema.properties.subjectContour.anyOf[0];
  assert.equal(contour.properties.grid.pattern, "^[01]{576}$");
  assert.deepEqual(contour.properties.gridSize.enum, [24]);
  assert.equal(contour.properties.subjectAreaRatio.maximum, 1);
  assert.deepEqual(schema.properties.subjectContour.anyOf[1], { type: "null" });

  const prompt = calls[0].messages[1].content[0].text;
  assert.match(prompt, /up to 12 face\/head boxes, empty array when none/);
  assert.match(prompt, /subjectContour/);
  assert.match(prompt, /576 characters of 0\/1 for a 24x24/);
  assert.match(prompt, /up to 48 normalized 0-1 vertices/);
});

test("normalizes faces that drift between box objects and [x1,y1,x2,y2] arrays", async () => {
  const result = await providerReturning(
    JSON.stringify({
      contentType: "portrait",
      faces: [
        [0.1, 0.1, 0.3, 0.3],
        { x: 0.5, y: 0.55, width: 0.2, height: 0.2 },
        [0.9, 0.1, 0.7, 0.2], // inverted corners -> zero width -> dropped
        { x: 0.1, y: 0.1, width: 0, height: 0.2 }, // zero area -> dropped
      ],
      subjectBox: null,
    }),
  ).analyze(visionInput);

  assert.deepEqual(result.faces, [
    // 0.3 - 0.1 keeps its floating-point shape, same as the detection path.
    { x: 0.1, y: 0.1, width: 0.3 - 0.1, height: 0.3 - 0.1 },
    { x: 0.5, y: 0.55, width: 0.2, height: 0.2 },
  ]);
  assert.deepEqual(result.analysisWarnings, []);
});

test("repairs a too-short single-line contour grid by padding and records a warning", async () => {
  const shortGrid = "1".repeat(288) + "0".repeat(287); // 575 chars
  const result = await providerReturning(
    JSON.stringify({
      contentType: "landscape",
      faces: [],
      subjectBox: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
      subjectContour: {
        grid: shortGrid,
        gridSize: 24,
        subjectAreaRatio: 9, // out of range -> clamped to 1
      },
    }),
  ).analyze(visionInput);

  const contour = result.subjectContour;
  assert.equal(contour.grid, shortGrid + "0");
  assert.equal(contour.grid.length, 576);
  assert.equal(contour.gridSize, 24);
  assert.equal(contour.subjectAreaRatio, 1);
  assert.equal(result.analysisWarnings.length, 1);
  assert.match(result.analysisWarnings[0], /subjectContour grid/);
  assert.match(result.analysisWarnings[0], /repaired/);
});

test("repairs line-broken grids row-wise: trim long rows, pad short ones, add missing rows", async () => {
  const fullZeroRow = "0".repeat(24);
  const rows = Array.from({ length: 23 }, () => fullZeroRow);
  rows[5] = "1".repeat(25); // one cell too long -> trimmed
  rows[9] = "0".repeat(23); // one cell short -> padded
  const result = await providerReturning(
    JSON.stringify({
      contentType: "landscape",
      faces: [],
      subjectBox: { x: 0.05, y: 0.3, width: 0.9, height: 0.45 },
      subjectContour: { grid: rows.join("\n"), gridSize: 24 },
    }),
  ).analyze(visionInput);

  const grid = result.subjectContour.grid;
  assert.equal(grid.length, 576);
  // Row 5 keeps only its first 24 cells; the 25th is trimmed away.
  assert.equal(grid.slice(5 * 24, 6 * 24), "1".repeat(24));
  // Row 9 is padded back to 24 zero cells.
  assert.equal(grid.slice(9 * 24, 10 * 24), fullZeroRow);
  // Only 23 rows were returned: the 24th is an all-zero repair row.
  assert.equal(grid.slice(23 * 24, 24 * 24), fullZeroRow);
  assert.match(result.analysisWarnings[0], /repaired/);
});

test("strips stray characters from the grid and derives the area ratio from the survivors", async () => {
  // 576 characters total, but 11 of them are neither 0 nor 1.
  const dirtyGrid = "1".repeat(288) + "2".repeat(10) + " " + "0".repeat(277);
  const result = await providerReturning(
    JSON.stringify({
      contentType: "landscape",
      faces: [],
      subjectBox: { x: 0.05, y: 0.3, width: 0.9, height: 0.45 },
      subjectContour: {
        grid: dirtyGrid,
        gridSize: 24,
        subjectAreaRatio: "high", // illegal -> counted from the repaired grid
      },
    }),
  ).analyze(visionInput);

  const contour = result.subjectContour;
  assert.equal(contour.grid, "1".repeat(288) + "0".repeat(288));
  assert.equal(contour.subjectAreaRatio, 0.5);
  assert.match(result.analysisWarnings[0], /repaired/);
});

test("falls back to a conservative all-inside-subjectBox grid when the contour grid is unusable", async () => {
  const result = await providerReturning(
    JSON.stringify({
      contentType: "portrait",
      faces: [],
      subjectBox: { x: 0, y: 0, width: 0.5, height: 0.5 },
      subjectContour: { grid: "not-a-grid", gridSize: 24, subjectAreaRatio: 0.25 },
    }),
  ).analyze(visionInput);

  const quarterRow = "1".repeat(12) + "0".repeat(12);
  const expectedGrid = [
    ...Array.from({ length: 12 }, () => quarterRow),
    ...Array.from({ length: 12 }, () => fullZeroRowHelper()),
  ].join("");
  const contour = result.subjectContour;
  assert.equal(contour.grid, expectedGrid);
  assert.equal(contour.gridSize, 24);
  assert.equal(contour.subjectAreaRatio, 0.25);
  assert.equal(result.analysisWarnings.length, 1);
  assert.match(result.analysisWarnings[0], /unusable/);
  assert.match(result.analysisWarnings[0], /subjectBox/);
});

test("omits subjectContour when the grid is unusable and no subjectBox exists", async () => {
  const result = await providerReturning(
    JSON.stringify({
      contentType: "object",
      faces: [],
      subjectBox: null,
      subjectContour: { grid: "", gridSize: 24 },
    }),
  ).analyze(visionInput);

  assert.equal(result.subjectContour, undefined);
  assert.equal(result.analysisWarnings.length, 1);
  assert.match(result.analysisWarnings[0], /subjectContour omitted/);
});

test("accepts both polygon shapes, drops illegal points, and caps vertices at 48", async () => {
  const contourGrid = "1".repeat(576);
  const dual = await providerReturning(
    JSON.stringify({
      contentType: "object",
      faces: [],
      subjectBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      subjectContour: {
        grid: contourGrid,
        gridSize: 24,
        subjectPolygon: [
          { x: 0.1, y: 0.2 },
          [0.3, 0.4],
          { x: "nope", y: 0.5 }, // non-numeric -> dropped
          [0.6, 0.7, 0.9], // wrong arity -> dropped
          { x: 0.8, y: 0.9 },
        ],
        subjectAreaRatio: 0.5,
      },
    }),
  ).analyze(visionInput);

  assert.deepEqual(dual.subjectContour.subjectPolygon, [
    { x: 0.1, y: 0.2 },
    { x: 0.3, y: 0.4 },
    { x: 0.8, y: 0.9 },
  ]);
  assert.deepEqual(dual.analysisWarnings, []);

  const fortyNine = Array.from({ length: 49 }, (_, i) => [
    i / 49,
    (48 - i) / 49,
  ]);
  const capped = await providerReturning(
    JSON.stringify({
      contentType: "object",
      faces: [],
      subjectBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      subjectContour: {
        grid: contourGrid,
        gridSize: 24,
        subjectPolygon: fortyNine,
        subjectAreaRatio: 0.5,
      },
    }),
  ).analyze(visionInput);
  assert.equal(capped.subjectContour.subjectPolygon.length, 48);
  assert.deepEqual(capped.subjectContour.subjectPolygon[0], { x: 0, y: 48 / 49 });
});

test("omits the polygon when fewer than 3 points survive", async () => {
  const result = await providerReturning(
    JSON.stringify({
      contentType: "object",
      faces: [],
      subjectBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      subjectContour: {
        grid: "1".repeat(576),
        gridSize: 24,
        subjectPolygon: [
          [0.1, 0.1],
          [0.9, 0.9],
          { x: null, y: 0.5 },
        ],
        subjectAreaRatio: 0.5,
      },
    }),
  ).analyze(visionInput);

  assert.equal("subjectPolygon" in result.subjectContour, false);
  assert.equal(result.subjectContour.gridSize, 24);
  assert.deepEqual(result.analysisWarnings, []);
});

test("keeps a fully valid subjectContour byte-identical without warnings", async () => {
  const valid = {
    contentType: "portrait",
    faces: [{ x: 0.3, y: 0.05, width: 0.2, height: 0.2 }],
    subjectBox: { x: 0.25, y: 0.05, width: 0.5, height: 0.9 },
    saliencyCenter: { x: 0.5, y: 0.5 },
    styleTags: ["close-up"],
    bestUse: ["hero"],
    cropSafety: "low",
    subjectContour: {
      grid: "0".repeat(120) + "1".repeat(24) + "0".repeat(432),
      gridSize: 24,
      subjectPolygon: [
        { x: 0.25, y: 0.05 },
        { x: 0.75, y: 0.05 },
        { x: 0.5, y: 0.95 },
      ],
      subjectAreaRatio: 24 / 576,
    },
  };
  const result = await providerReturning(JSON.stringify(valid)).analyze(
    visionInput,
  );

  const { analysisWarnings, ...parsed } = result;
  assert.deepEqual(analysisWarnings, []);
  assert.deepEqual(parsed, valid);
});

test("carries faces and subjectContour into the merged analysis", () => {
  const contour = {
    grid: "0".repeat(576),
    gridSize: 24,
    subjectAreaRatio: 0,
  };
  const merged = mergeVisionAnalysis(basicAnalysis, {
    ...patch,
    subjectContour: contour,
  });

  assert.equal(merged.averageColor, "#223344");
  assert.equal(merged.faces.length, 1);
  assert.deepEqual(merged.subjectContour, contour);
});

function fullZeroRowHelper() {
  return "0".repeat(24);
}

test("downsizes large originals before calling the vision model", async () => {
  const sharp = (await import("sharp")).default;
  const bigImage = await sharp({
    create: { width: 2000, height: 4000, channels: 3, background: "#336699" },
  })
    .jpeg()
    .toBuffer();
  const validPatch = {
    contentType: "portrait",
    faces: [],
    subjectBox: { x: 0.2, y: 0.05, width: 0.6, height: 0.9 },
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
    faces: [],
    subjectBox: null,
    saliencyCenter: { x: 0.5, y: 0.5 },
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
