import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  averageBestMatchIoU,
  buildForegroundMask,
  compileRecipeSlotRects,
  connectedComponentBlocks,
  createReversePrompt,
  DEFAULT_STYLE_REVERSE_VISION_MODEL,
  detectDominantBackground,
  detectReferenceBlocks,
  loadStyleReverseModelConfig,
  reverseEngineer,
  STYLE_REVERSE_SYSTEM_PROMPT,
  StyleReverseError,
} from "./styleReverse.ts";
import { templateRecipeSchema } from "../../packages/core/src/layout/templateRecipe.ts";

// ---------------------------------------------------------------------------
// Every test below runs offline: geometry on sharp-synthesized rasters or
// synthetic masks, prompts as pure functions, and the VLM path against an
// injected fake OpenAI client. The only network test is the LLM_API_KEY-gated
// integration case at the bottom, which skips itself without the key.
// ---------------------------------------------------------------------------

const OLIVE = { r: 74, g: 93, b: 58 }; // #4A5D3A, the reference canvas color.

/** Fills a raw 3-channel raster with copies of one color. */
function solidRaster(width, height, color) {
  const pixels = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = color.r;
    pixels[index * 3 + 1] = color.g;
    pixels[index * 3 + 2] = color.b;
  }
  return pixels;
}

/** Binary mask of a w*h raster with set(x, y) true for foreground pixels. */
function maskFromPredicate(width, height, isSet) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      mask[y * width + x] = isSet(x, y) ? 1 : 0;
    }
  }
  return mask;
}

/** White canvas with the given filled rectangles (normalized boxes). */
async function blocksFixture(width, height, rects, fills) {
  const shapes = rects.map((rect, index) => {
    const fill = fills?.[index] ?? "#101010";
    return (
      `<rect x="${Math.round(rect.x * width)}" y="${Math.round(rect.y * height)}" ` +
      `width="${Math.round(rect.width * width)}" height="${Math.round(rect.height * height)}" fill="${fill}"/>`
    );
  });
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shapes.join("")}</svg>`,
  );
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 250, g: 250, b: 250 },
    },
  })
    .composite([{ input: svg, blend: "over" }])
    .png()
    .toBuffer();
}

const HERO_GRID_RECIPE = {
  version: "1.0",
  profile: "safe",
  family: "hero-grid",
  heroPosition: "left",
  heroShare: 0.5,
  supportCount: 1,
  margin: 0.02,
  gap: 0.05,
  cornerRadius: 0,
  rhythm: "ordered",
  boundary: "clean-gap",
  safeAreaPolicy: "avoid",
};

const DIAGONAL_RECIPE = {
  version: "1.0",
  profile: "dynamic",
  family: "diagonal-collage",
  heroPosition: "center",
  heroShare: 0.46,
  supportCount: 3,
  margin: 0.025,
  gap: 0.008,
  cornerRadius: 0,
  rhythm: "layered",
  boundary: "overlap",
  safeAreaPolicy: "soft-avoid",
  diagonal: { backgroundColor: "#4A5D3A", axis: "bl-tr" },
  slotIntents: {
    hero: { treatment: "crop" },
    "support-1": { treatment: "cutout" },
  },
};

// ---------------------------------------------------------------------------
// IoU
// ---------------------------------------------------------------------------

test("averageBestMatchIoU scores known overlaps and stays 0 on empty inputs", () => {
  const a = { x: 0, y: 0, width: 0.5, height: 0.5 };
  // Half-width overlap: inter 0.125, union 0.375 -> 1/3.
  const halfOverlap = { x: 0.25, y: 0, width: 0.5, height: 0.5 };
  assert.ok(
    Math.abs(averageBestMatchIoU([a], [halfOverlap]) - 1 / 3) < 1e-12,
  );
  assert.equal(averageBestMatchIoU([a], [a]), 1);
  // Two slots each matched by their own identical block.
  const b = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 };
  assert.equal(averageBestMatchIoU([a, b], [b, a]), 1);
  // Best-match: a slot scores its best block, not the average over blocks.
  const stray = { x: 0.9, y: 0.9, width: 0.1, height: 0.1 };
  assert.equal(averageBestMatchIoU([a], [halfOverlap, stray]), 1 / 3);
  assert.equal(averageBestMatchIoU([a], []), 0);
  assert.equal(averageBestMatchIoU([], [a]), 0);
});

// ---------------------------------------------------------------------------
// Background detection + foreground mask (pure functions)
// ---------------------------------------------------------------------------

test("detectDominantBackground trusts the border ring over a majority subject", () => {
  const width = 8;
  const height = 4;
  const pixels = solidRaster(width, height, OLIVE);
  // One out-of-bin red pixel must not move the olive majority.
  pixels[0] = 220;
  pixels[1] = 20;
  pixels[2] = 30;
  const background = detectDominantBackground(pixels, width, height);
  assert.equal(background.r, OLIVE.r);
  assert.equal(background.g, OLIVE.g);
  assert.equal(background.b, OLIVE.b);

  // Dense collage regime: 6 of 32 pixels stay canvas color, the rest are a
  // dark subject that would win a global vote. The all-olive border ring
  // still resolves the background as olive.
  const dense = solidRaster(8, 4, { r: 16, g: 16, b: 16 });
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (x === 0 || y === 0 || x === 7 || y === 3) {
        const index = (y * 8 + x) * 3;
        dense[index] = OLIVE.r;
        dense[index + 1] = OLIVE.g;
        dense[index + 2] = OLIVE.b;
      }
    }
  }
  const denseBackground = detectDominantBackground(dense, 8, 4);
  assert.deepEqual(denseBackground, OLIVE);

  // No pixels at all -> the zero color, never a crash.
  assert.deepEqual(detectDominantBackground(new Uint8Array(0), 0, 0), {
    r: 0,
    g: 0,
    b: 0,
  });

  // A mixed border with no clear majority falls back to the global vote.
  const mixed = solidRaster(8, 4, OLIVE);
  for (let x = 0; x < 8; x += 1) {
    const top = x * 3;
    mixed[top] = 200;
    mixed[top + 1] = 30;
    mixed[top + 2] = 30;
  }
  assert.deepEqual(detectDominantBackground(mixed, 8, 4), OLIVE);
});

test("buildForegroundMask marks only pixels far from the background", () => {
  const pixels = solidRaster(4, 1, OLIVE);
  // Raw raster is 3 bytes per pixel: pixel 1 spans bytes 3..5.
  pixels[3] = 200; // far red channel on pixel 1, > 48 Euclidean distance.
  pixels[6] = OLIVE.r + 10; // near tint on pixel 2, stays background.
  const mask = buildForegroundMask(pixels, OLIVE);
  assert.deepEqual(Array.from(mask), [0, 1, 0, 0]);
});

// ---------------------------------------------------------------------------
// Connected components (pure function on synthetic masks)
// ---------------------------------------------------------------------------

test("connectedComponentBlocks returns normalized boxes, largest first", () => {
  const mask = maskFromPredicate(20, 20, (x, y) => {
    const inA = x >= 2 && x <= 6 && y >= 2 && y <= 6; // 5x5 = 25 px
    const inB = x >= 12 && x <= 15 && y >= 8 && y <= 12; // 4x5 = 20 px
    return inA || inB;
  });
  const blocks = connectedComponentBlocks(mask, 20, 20, {
    minAreaPixels: 5,
    maxBlocks: 8,
  });
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { x: 0.1, y: 0.1, width: 0.25, height: 0.25 });
  assert.deepEqual(blocks[1], { x: 0.6, y: 0.4, width: 0.2, height: 0.25 });
});

test("corner-touching blobs stay separate (4-connectivity) and noise is dropped", () => {
  const mask = maskFromPredicate(10, 10, (x, y) => {
    const left = x >= 2 && x <= 3 && y >= 2 && y <= 3;
    const right = x >= 4 && x <= 5 && y >= 4 && y <= 5; // touches at corner
    const noise = x === 8 && y === 8; // single pixel
    return left || right || noise;
  });
  const blocks = connectedComponentBlocks(mask, 10, 10, {
    minAreaPixels: 4,
    maxBlocks: 8,
  });
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { x: 0.2, y: 0.2, width: 0.2, height: 0.2 });
  assert.deepEqual(blocks[1], { x: 0.4, y: 0.4, width: 0.2, height: 0.2 });
});

test("connectedComponentBlocks caps the block count by area", () => {
  const big = maskFromPredicate(30, 10, (x) => x >= 0 && x <= 20);
  const small = maskFromPredicate(30, 10, (x) => x >= 24 && x <= 27);
  const combined = new Uint8Array(big.length);
  for (let index = 0; index < big.length; index += 1) {
    combined[index] = big[index] | small[index];
  }
  const blocks = connectedComponentBlocks(combined, 30, 10, {
    minAreaPixels: 4,
    maxBlocks: 1,
  });
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { x: 0, y: 0, width: 21 / 30, height: 1 });
});

// ---------------------------------------------------------------------------
// Block detection on sharp-synthesized images
// ---------------------------------------------------------------------------

test("detectReferenceBlocks finds both rectangles of a two-block fixture", async () => {
  const buffer = await blocksFixture(
    200,
    150,
    [
      { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
      { x: 0.65, y: 0.1333, width: 0.25, height: 0.8 },
    ],
    ["#101010", "#808080"],
  );
  const blocks = await detectReferenceBlocks(buffer, "image/png");
  assert.equal(blocks.length, 2);
  const tolerance = 0.03; // working-raster edge rounding, ~4 px at 200 wide
  for (const block of blocks) {
    const nearest = [
      { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
      { x: 0.65, y: 0.1333, width: 0.25, height: 0.8 },
    ].reduce((best, rect) =>
      averageBestMatchIoU([block], [rect]) > averageBestMatchIoU([block], [best])
        ? rect
        : best,
    );
    for (const key of ["x", "y", "width", "height"]) {
      assert.ok(
        Math.abs(block[key] - nearest[key]) <= tolerance,
        `${key}: ${block[key]} vs ${nearest[key]}`,
      );
    }
  }
});

test("detectReferenceBlocks returns [] for a uniform image", async () => {
  const buffer = await sharp({
    create: { width: 64, height: 64, channels: 3, background: OLIVE },
  })
    .png()
    .toBuffer();
  assert.deepEqual(await detectReferenceBlocks(buffer, "image/png"), []);
});

test("detectReferenceBlocks rejects non-image inputs", async () => {
  await assert.rejects(
    () => detectReferenceBlocks("not-a-buffer", "image/png"),
    (error) => error instanceof TypeError,
  );
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#333333" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    () => detectReferenceBlocks(buffer, "text/plain"),
    (error) => error instanceof TypeError,
  );
});

// ---------------------------------------------------------------------------
// Recipe -> slot boxes (deterministic compile with fake assets)
// ---------------------------------------------------------------------------

test("compileRecipeSlotRects is deterministic and schema-clean", () => {
  const first = compileRecipeSlotRects(DIAGONAL_RECIPE, 1800, 2400);
  const second = compileRecipeSlotRects(DIAGONAL_RECIPE, 1800, 2400);
  assert.deepEqual(first, second);
  // diagonal-collage: hero + hero-2 + 3 supports, no background slot.
  assert.equal(first.length, 5);
  for (const rect of first) {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.width > 0 && rect.height > 0);
    assert.ok(rect.x + rect.width <= 1.000001);
    assert.ok(rect.y + rect.height <= 1.000001);
  }
  // hero-grid with supportCount 1 compiles to hero + support-1.
  assert.equal(
    compileRecipeSlotRects(HERO_GRID_RECIPE, 3840, 2400).length,
    2,
  );
});

test("compileRecipeSlotRects excludes the layered background slot", () => {
  const layered = {
    ...HERO_GRID_RECIPE,
    family: "layered-collage",
    heroPosition: "background",
    rhythm: "layered",
    boundary: "overlap",
    supportCount: 3,
  };
  const rects = compileRecipeSlotRects(layered, 1200, 800);
  // supportCount+1 = 4 slots compile to background + hero + 2 supports; the
  // full-canvas background is the canvas, not a block, so only 3 remain.
  assert.equal(rects.length, 3);
});

// ---------------------------------------------------------------------------
// Geometry self-check end to end (rendered slots vs detected blocks)
// ---------------------------------------------------------------------------

test("rendered slot boxes detect back near-perfectly (self-check pipeline)", async () => {
  const slotRects = compileRecipeSlotRects(HERO_GRID_RECIPE, 400, 300);
  assert.equal(slotRects.length, 2);
  // Render the compiled slot boxes as black rectangles on a white canvas.
  const rendered = await blocksFixture(400, 300, slotRects, ["#101010", "#101010"]);
  const detected = await detectReferenceBlocks(rendered, "image/png");
  assert.equal(detected.length, 2);
  const iou = averageBestMatchIoU(slotRects, detected);
  assert.ok(
    iou >= 0.85,
    `rendered self-check IoU ${iou} should be near 1 for exact slot rects`,
  );
});

// ---------------------------------------------------------------------------
// Prompt construction (pure)
// ---------------------------------------------------------------------------

test("createReversePrompt embeds families, treatments, structure and JSON contract", () => {
  const prompt = createReversePrompt({ width: 1800, height: 2400 });
  for (const family of [
    "hero-grid",
    "balanced-mosaic",
    "triptych",
    "stacked-story",
    "layered-collage",
    "diagonal-collage",
  ]) {
    assert.ok(prompt.includes(family), `family ${family} missing`);
  }
  for (const treatment of ["full", "crop", "cutout"]) {
    assert.ok(prompt.includes(`"${treatment}"`), `treatment ${treatment} missing`);
  }
  assert.match(prompt, /1800x2400/);
  assert.match(prompt, /Return exactly one JSON object/);
  assert.match(prompt, /"recipe"/);
  assert.match(prompt, /"styleNotes"/);
  assert.match(prompt, /"confidence"/);
  assert.match(prompt, /"hero-2"/);
  assert.match(prompt, /slotIntents/);
  assert.doesNotMatch(prompt, /Correction context/);
  assert.doesNotMatch(prompt, /failed schema validation/);
});

test("createReversePrompt appends the hint correction block only with a hint", () => {
  const hint = {
    previousRecipeJson: JSON.stringify(HERO_GRID_RECIPE),
    detectedBlocks: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }],
    previousIoU: 0.31,
  };
  const prompt = createReversePrompt({ width: 900, height: 1200, hint });
  assert.match(prompt, /Correction context/);
  assert.match(prompt, /"hero-grid"/);
  assert.match(prompt, /0\.31/);
  assert.match(prompt, /"width":0\.4/);
  assert.match(prompt, /target >= 0\.5/);

  const retryPrompt = createReversePrompt({
    width: 900,
    height: 1200,
    validationError: new Error("bad recipe shape"),
  });
  assert.match(retryPrompt, /failed schema validation/);
  assert.match(retryPrompt, /bad recipe shape/);
  assert.doesNotMatch(retryPrompt, /Correction context/);
});

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

test("loadStyleReverseModelConfig defaults to the glm-5v vision model on the relay", () => {
  assert.equal(loadStyleReverseModelConfig({}), null);
  assert.equal(
    loadStyleReverseModelConfig({ LLM_API_KEY: "  " }),
    null,
  );
  const defaults = loadStyleReverseModelConfig({ LLM_API_KEY: "key" });
  assert.deepEqual(defaults, {
    apiKey: "key",
    baseURL: "https://api.openai.com/v1",
    model: DEFAULT_STYLE_REVERSE_VISION_MODEL,
    timeoutMs: 90_000,
    streaming: false,
  });
  assert.equal(DEFAULT_STYLE_REVERSE_VISION_MODEL, "cn:glm-5v-turbo");
  const overridden = loadStyleReverseModelConfig({
    LLM_API_KEY: "key",
    LLM_BASE_URL: "https://moonpulse.online/v1",
    VISION_MODEL: "cn:glm-5v-pro",
    VISION_TIMEOUT_MS: "30000",
    LLM_STREAMING: "true",
  });
  assert.deepEqual(overridden, {
    apiKey: "key",
    baseURL: "https://moonpulse.online/v1",
    model: "cn:glm-5v-pro",
    timeoutMs: 30_000,
    streaming: true,
  });
});

// ---------------------------------------------------------------------------
// VLM path against an injected fake client (offline)
// ---------------------------------------------------------------------------

const VALID_RESPONSE = JSON.stringify({
  recipe: DIAGONAL_RECIPE,
  styleNotes: "扁平杂志感拼贴：粉色标题条与椭圆点缀无法用配方表达。",
  confidence: 0.82,
});

const INVALID_RESPONSE = JSON.stringify({
  recipe: { ...DIAGONAL_RECIPE, supportCount: 9 },
  styleNotes: "支持数超限",
  confidence: 0.5,
});

function fakeClient(responses) {
  const calls = [];
  let index = 0;
  return {
    calls,
    client: {
      chat: {
        completions: {
          async create(body) {
            calls.push(body);
            const response = responses[Math.min(index, responses.length - 1)];
            index += 1;
            if (body.stream === true) {
              return (async function* streamChunks() {
                for (const chunk of splitIntoChunks(response)) {
                  yield { choices: [{ delta: { content: chunk } }] };
                }
              })();
            }
            return { choices: [{ message: { content: response, refusal: null } }] };
          },
        },
      },
    },
  };
}

function splitIntoChunks(text) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += 40) {
    chunks.push(text.slice(offset, offset + 40));
  }
  return chunks;
}

async function syntheticReference() {
  // Olive canvas with three clearly separated light blocks (no 4-connected
  // adjacency between any pair, checked at both source and working scale).
  const buffer = await blocksFixture(
    360,
    480,
    [
      { x: 0.05, y: 0.62, width: 0.4, height: 0.28 },
      { x: 0.55, y: 0.08, width: 0.35, height: 0.3 },
      { x: 0.36, y: 0.42, width: 0.18, height: 0.12 },
    ],
    ["#e8e2d0", "#e8e2d0", "#e8e2d0"],
  );
  return {
    buffer,
    mimeType: "image/png",
    width: 360,
    height: 480,
  };
}

test("reverseEngineer parses a valid VLM response and self-checks geometry", async () => {
  const { client, calls } = fakeClient([VALID_RESPONSE]);
  const reference = await syntheticReference();
  const result = await reverseEngineer(reference, undefined, {
    environment: { LLM_API_KEY: "test-key" },
    client,
  });

  // Recipe is schema-valid (re-parsed independently here).
  assert.deepEqual(
    templateRecipeSchema.parse(result.recipe),
    result.recipe,
  );
  assert.equal(result.recipe.family, "diagonal-collage");
  assert.equal(result.confidence, 0.82);
  assert.ok(result.styleNotes.length > 0);
  assert.ok(Array.isArray(result.warnings));
  assert.ok(result.detectedBlocks.length >= 2);
  assert.ok(result.selfCheckIoU >= 0 && result.selfCheckIoU <= 1);

  // Request shape: system prompt, JSON-only text contract, attached image.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, DEFAULT_STYLE_REVERSE_VISION_MODEL);
  assert.equal(calls[0].messages[0].content, STYLE_REVERSE_SYSTEM_PROMPT);
  const text = calls[0].messages[1].content[0].text;
  assert.match(text, /diagonal-collage/);
  assert.match(text, /Return exactly one JSON object/);
  assert.match(
    calls[0].messages[1].content[1].image_url.url,
    /^data:image\/png;base64,/,
  );
});

test("reverseEngineer retries exactly once with the validation error appended", async () => {
  const { client, calls } = fakeClient([INVALID_RESPONSE, VALID_RESPONSE]);
  const reference = await syntheticReference();
  const result = await reverseEngineer(reference, undefined, {
    environment: { LLM_API_KEY: "test-key" },
    client,
  });

  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0].messages[1].content[0].text, /failed schema validation/);
  assert.match(calls[1].messages[1].content[0].text, /failed schema validation/);
  assert.ok(
    result.warnings.some((warning) => /failed schema validation/.test(warning)),
  );
  assert.equal(result.recipe.supportCount, 3);
});

test("reverseEngineer throws StyleReverseError when the retry still fails", async () => {
  const { client, calls } = fakeClient([INVALID_RESPONSE, INVALID_RESPONSE]);
  const reference = await syntheticReference();
  await assert.rejects(
    () =>
      reverseEngineer(reference, undefined, {
        environment: { LLM_API_KEY: "test-key" },
        client,
      }),
    (error) =>
      error instanceof StyleReverseError &&
      error.code === "invalid_response" &&
      /after one retry/.test(error.message),
  );
  assert.equal(calls.length, 2);
});

test("reverseEngineer forwards the hint into the prompt", async () => {
  const { client, calls } = fakeClient([VALID_RESPONSE]);
  const reference = await syntheticReference();
  await reverseEngineer(
    reference,
    {
      previousRecipeJson: JSON.stringify(HERO_GRID_RECIPE),
      detectedBlocks: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }],
      previousIoU: 0.31,
    },
    { environment: { LLM_API_KEY: "test-key" }, client },
  );
  assert.match(calls[0].messages[1].content[0].text, /Correction context/);
  assert.match(calls[0].messages[1].content[0].text, /0\.31/);
});

test("reverseEngineer streams deltas when LLM_STREAMING=true", async () => {
  const { client, calls } = fakeClient([VALID_RESPONSE]);
  const reference = await syntheticReference();
  const result = await reverseEngineer(reference, undefined, {
    environment: {
      LLM_API_KEY: "test-key",
      LLM_STREAMING: "true",
    },
    client,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stream, true);
  assert.equal(result.recipe.family, "diagonal-collage");
  assert.equal(result.confidence, 0.82);
});

test("reverseEngineer requires configuration and image-shaped input", async () => {
  const reference = await syntheticReference();
  await assert.rejects(
    () => reverseEngineer(reference, undefined, { environment: {} }),
    (error) =>
      error instanceof StyleReverseError && error.code === "configuration",
  );
  await assert.rejects(
    () =>
      reverseEngineer(
        { ...reference, mimeType: "text/plain" },
        undefined,
        { environment: { LLM_API_KEY: "key" }, client: fakeClient([VALID_RESPONSE]).client },
      ),
    (error) => error instanceof TypeError,
  );
  await assert.rejects(
    () =>
      reverseEngineer(
        { ...reference, buffer: "not-a-buffer" },
        undefined,
        { environment: { LLM_API_KEY: "key" }, client: fakeClient([VALID_RESPONSE]).client },
      ),
    (error) => error instanceof TypeError,
  );
  await assert.rejects(
    () =>
      reverseEngineer(
        { ...reference, width: 0 },
        undefined,
        { environment: { LLM_API_KEY: "key" }, client: fakeClient([VALID_RESPONSE]).client },
      ),
    (error) => error instanceof TypeError,
  );
});

test("reverseEngineer downsizes large references before the VLM call", async () => {
  const big = await sharp({
    create: {
      width: 1200,
      height: 2000,
      channels: 3,
      background: { r: 74, g: 93, b: 58 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="2000">` +
            `<rect x="100" y="1200" width="500" height="400" fill="#e8e2d0"/>` +
            `<rect x="650" y="200" width="420" height="350" fill="#e8e2d0"/></svg>`,
        ),
        blend: "over",
      },
    ])
    .png()
    .toBuffer();
  const { client, calls } = fakeClient([VALID_RESPONSE]);
  await reverseEngineer(
    { buffer: big, mimeType: "image/png", width: 1200, height: 2000 },
    undefined,
    { environment: { LLM_API_KEY: "key" }, client },
  );
  const url = calls[0].messages[1].content[1].image_url.url;
  assert.equal(url.startsWith("data:image/jpeg;base64,"), true);
  const decoded = await sharp(
    Buffer.from(url.slice("data:image/jpeg;base64,".length), "base64"),
  ).metadata();
  assert.equal(Math.max(decoded.width, decoded.height) <= 1536, true);
  assert.ok(Math.min(decoded.width, decoded.height) > 0);
});

// ---------------------------------------------------------------------------
// Integration (network): only with LLM_API_KEY in the environment
// ---------------------------------------------------------------------------

const hasLlmApiKey = Boolean(process.env.LLM_API_KEY?.trim());

test(
  "reverseEngineer integration against the configured relay",
  {
    skip: !hasLlmApiKey && "LLM_API_KEY not set",
    timeout: 180_000,
  },
  async () => {
    const reference = await syntheticReference();
    const result = await reverseEngineer(reference);
    templateRecipeSchema.parse(result.recipe);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.ok(result.selfCheckIoU >= 0 && result.selfCheckIoU <= 1);
    assert.ok(Array.isArray(result.detectedBlocks));
    assert.ok(result.styleNotes.length > 0);
  },
);
