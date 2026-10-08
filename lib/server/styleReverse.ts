import OpenAI from "openai";
import { z } from "zod";
import sharp from "sharp";

import {
  extractJsonValue,
} from "../../packages/core/src/layout-generation/openAiCompatibleProvider.ts";
import { compileTemplateRecipe } from "../../packages/core/src/layout/compileTemplateRecipe.ts";
import { templateRecipeSchema } from "../../packages/core/src/layout/templateRecipe.ts";
import { boxIoU } from "./localVision.ts";

import type { TemplateRecipe } from "../../packages/core/src/layout/templateRecipe.ts";
import type {
  ImageAssetAnalysis,
  TemplateSlot,
} from "../../packages/core/src/types/layout.ts";
import type { NormalizedBox } from "./localVision.ts";

// Style reverse engine ("参考图 → 操作配方"): a multimodal LLM infers a
// TemplateRecipe from a reference collage image, then a deterministic
// sharp-only geometry self-check measures how well the compiled slot boxes
// match the reference's foreground blocks (average best-match IoU).
//
// Layering: the VLM owns semantics (recipe + styleNotes + confidence), the
// local layer owns verification. The VLM output is validated with zod
// (templateRecipeSchema included) and retried exactly once with the
// validation error appended; the self-check never touches the network.

export type DetectedBlock = NormalizedBox;

export interface ReverseEngineerImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface ReverseHint {
  /** Previous round's recipe, JSON-serialized TemplateRecipe. */
  previousRecipeJson: string;
  /** Previous round's deterministic block detection on the same reference. */
  detectedBlocks: DetectedBlock[];
  /** Previous round's self-check IoU. */
  previousIoU: number;
}

export interface ReverseResult {
  recipe: TemplateRecipe;
  styleNotes: string;
  confidence: number;
  warnings: string[];
  detectedBlocks: DetectedBlock[];
  selfCheckIoU: number;
}

export type StyleReverseErrorCode = "configuration" | "invalid_response";

export class StyleReverseError extends Error {
  readonly code: StyleReverseErrorCode;

  constructor(code: StyleReverseErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StyleReverseError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Model configuration (mirrors llmConfig.ts / visionProvider.ts conventions)
// ---------------------------------------------------------------------------

export interface StyleReverseModelConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
  /** Present only when LLM_STREAMING is exactly "true" (same gate as planning). */
  streaming: boolean;
}

/** Vision model used for reverse engineering; overridable via VISION_MODEL. */
export const DEFAULT_STYLE_REVERSE_VISION_MODEL = "cn:glm-5v-turbo";

/**
 * Resolves the moonpulse relay configuration the same way the existing
 * callers do: LLM_API_KEY is required, LLM_BASE_URL defaults to the OpenAI
 * endpoint, the vision model prefers VISION_MODEL and otherwise falls back to
 * the glm-5v-turbo default, VISION_TIMEOUT_MS bounds the call, and
 * LLM_STREAMING="true" switches the completion to streamed deltas (relays
 * whose idle timeouts would cut off long-thinking models).
 */
export function loadStyleReverseModelConfig(
  environment: Record<string, string | undefined> = process.env,
): StyleReverseModelConfig | null {
  const apiKey = environment.LLM_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const timeout = Number(environment.VISION_TIMEOUT_MS ?? "90000");
  return {
    apiKey,
    baseURL:
      environment.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
    model:
      environment.VISION_MODEL?.trim() ||
      DEFAULT_STYLE_REVERSE_VISION_MODEL,
    timeoutMs:
      Number.isFinite(timeout) && timeout >= 1_000 ? timeout : 90_000,
    streaming: environment.LLM_STREAMING === "true",
  };
}

// ---------------------------------------------------------------------------
// Prompt construction (pure, unit-tested)
// ---------------------------------------------------------------------------

export const STYLE_REVERSE_SYSTEM_PROMPT =
  "You reverse-engineer wallpaper collage reference images into a TemplateRecipe JSON. Output JSON only - no markdown fences, no commentary. Never identify a person.";

const RECIPE_FAMILIES = [
  "hero-grid",
  "balanced-mosaic",
  "triptych",
  "stacked-story",
  "layered-collage",
  "diagonal-collage",
] as const;

const OUTPUT_CONTRACT =
  'Return exactly one JSON object and nothing else: {"recipe": <recipe object>, "styleNotes": "<one concise paragraph, English or Chinese, describing what the recipe cannot express: decorations, text banners, textures, tapes, frames, background patterns>", "confidence": <0..1 number, how confidently the recipe reproduces the reference layout>}';

const STRUCTURE_DOC = [
  'Recipe JSON structure (all fields required unless marked optional):',
  "{",
  '  "version": "1.0",',
  '  "profile": "safe" | "editorial" | "dynamic",',
  '  "family": "hero-grid" | "balanced-mosaic" | "triptych" | "stacked-story" | "layered-collage" | "diagonal-collage",',
  '  "heroPosition": "left" | "right" | "top" | "bottom" | "center" | "background",',
  '  "heroShare": number 0.32..0.76,',
  '  "supportCount": integer 1..5,',
  '  "margin": number 0..0.3,',
  '  "gap": number 0..0.06,',
  '  "cornerRadius": number 0..0.08,',
  '  "rhythm": "ordered" | "asymmetric" | "layered",',
  '  "boundary": "edge-to-edge" | "clean-gap" | "hairline" | "soft-shadow" | "overlap" | "feather" | "paper-edge",',
  '  "safeAreaPolicy": "avoid" | "soft-avoid",',
  '  "slotIntents": optional map of slot id -> { "cropIntent": { "focus": "subject"|"saliency"|"center"|"contour"|"faces"|{"x":0..1,"y":0..1}, "zoom": "tight"|"standard"|"loose" }, "visualWeight": "dominant"|"balanced"|"subtle", "treatment": "full"|"crop"|"cutout" },',
  '  "layering": optional "none" | "slight" | "strong",',
  '  "diagonal": optional, only for family "diagonal-collage": { "backgroundColor": "#rrggbb", "axis": "bl-tr"|"tl-br", "heroShare": number 0.2..0.6, "supportShare": number 0.1..0.4, "overlap": number 0..0.6 }',
  "}",
  'Treatment semantics: "full" = whole image fitted into the slot without cropping; "crop" = cover-crop to fill the slot; "cutout" = background removed, subject only. Default "crop".',
  'Slot ids: "hero", "support-1" onward; layered-collage also has "background"; diagonal-collage has "hero" (bottom-left end of the axis), "hero-2" (opposite end), then "support-1" onward stacked along the diagonal axis.',
].join("\n");

const FAMILY_HINTS = [
  "Family reading guide: hero-grid = one hero plus an ordered support grid; balanced-mosaic = centered hero with supports mirrored around it; triptych and stacked-story = strip layouts; layered-collage = full-canvas background with layered hero and support cards; diagonal-collage = two heroes on opposite diagonal corners with supports interleaved along the axis (hard stacking, no gaps).",
].join("\n");

function hintBlock(hint: ReverseHint): string {
  return [
    "Correction context from a previous attempt that missed the reference geometry:",
    `- previous recipe: ${hint.previousRecipeJson}`,
    `- reference foreground blocks detected by the deterministic self-check (normalized x/y/width/height): ${JSON.stringify(hint.detectedBlocks)}`,
    `- previous self-check IoU was ${hint.previousIoU} (target >= 0.5)`,
    "Adjust the recipe family and knobs so the compiled slot boxes match the detected blocks better; change the family itself when the previous one cannot express the arrangement.",
  ].join("\n");
}

function validationRetryBlock(error: unknown): string {
  const message =
    error instanceof z.ZodError
      ? error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")
      : error instanceof Error
        ? error.message
        : String(error);
  return `Your previous response failed schema validation: ${message}. Return a corrected JSON object following the structure above exactly.`;
}

export interface CreateReversePromptInput {
  width: number;
  height: number;
  hint?: ReverseHint;
  /** Set on the single retry after a zod failure, so the model sees its error. */
  validationError?: unknown;
}

/**
 * Builds the user text prompt for the reverse call. Pure function: same input
 * always produces the same string (unit-tested).
 */
export function createReversePrompt(input: CreateReversePromptInput): string {
  const sections = [
    `Task: reverse-engineer the attached wallpaper collage reference image (${input.width}x${input.height} px) into a TemplateRecipe.`,
    `Recipe families (choose exactly one): ${RECIPE_FAMILIES.join(" | ")}.`,
    FAMILY_HINTS,
    STRUCTURE_DOC,
    OUTPUT_CONTRACT,
  ];
  if (input.hint) {
    sections.push(hintBlock(input.hint));
  }
  if (input.validationError !== undefined) {
    sections.push(validationRetryBlock(input.validationError));
  }
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// VLM response schema
// ---------------------------------------------------------------------------

const reverseResponseSchema = z
  .object({
    recipe: templateRecipeSchema,
    styleNotes: z.string().trim().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Deterministic geometry: background detection + connected blocks (sharp)
// ---------------------------------------------------------------------------

/** Longest edge of the working raster the self-check runs on. */
export const SELF_CHECK_WORKING_MAX_DIMENSION = 256;
/** RGB channels are quantized to 4 bits for the dominant-color vote. */
const BACKGROUND_QUANTIZATION_SHIFT = 4;
/** Euclidean RGB distance (0-255 per channel) separating foreground pixels. */
export const FOREGROUND_COLOR_DISTANCE = 48;
/** Blocks smaller than this share of the working raster are noise. */
export const MIN_BLOCK_AREA_RATIO = 0.0015;
/** Absolute noise floor in working pixels, for very small references. */
export const MIN_BLOCK_AREA_PIXELS = 24;
/** Cap on returned blocks (largest by area win). */
export const MAX_DETECTED_BLOCKS = 8;

export interface DominantColor {
  r: number;
  g: number;
  b: number;
}

/** Share of border pixels the winning bin must hold to be trusted as canvas. */
export const BORDER_BACKGROUND_COVERAGE = 0.5;
/** Border ring thickness, as a fraction of the shorter working edge. */
const BORDER_THICKNESS_RATIO = 0.02;

interface ColorBin {
  count: number;
  r: number;
  g: number;
  b: number;
}

function voteDominantBin(
  pixels: Uint8Array | Buffer,
  pixelIndices: Iterable<number> | null,
): { bin: ColorBin | null; total: number } {
  const counts = new Map<number, ColorBin>();
  let total = 0;
  const consume = (index: number): void => {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const key =
      ((r >> BACKGROUND_QUANTIZATION_SHIFT) << 8) |
      ((g >> BACKGROUND_QUANTIZATION_SHIFT) << 4) |
      (b >> BACKGROUND_QUANTIZATION_SHIFT);
    const bin = counts.get(key);
    if (bin === undefined) {
      counts.set(key, { count: 1, r, g, b });
    } else {
      bin.count += 1;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    }
    total += 1;
  };
  if (pixelIndices === null) {
    for (let index = 0; index + 2 < pixels.length; index += 3) {
      consume(index);
    }
  } else {
    for (const index of pixelIndices) {
      consume(index * 3);
    }
  }
  let best: ColorBin | null = null;
  for (const bin of counts.values()) {
    // Ties keep the first-inserted bin, so the vote stays deterministic.
    if (best === null || bin.count > best.count) {
      best = bin;
    }
  }
  return { bin: best, total };
}

function binMeanColor(bin: ColorBin): DominantColor {
  return {
    r: Math.round(bin.r / bin.count),
    g: Math.round(bin.g / bin.count),
    b: Math.round(bin.b / bin.count),
  };
}

/**
 * Dominant background color of a raw sRGB raster. Collage references put the
 * canvas color on the image border, so the border ring votes first: when its
 * winning 4-bit-per-channel quantization bin covers at least
 * BORDER_BACKGROUND_COVERAGE of the border, that bin's mean color is the
 * background (flat-canvas references resolve exactly even when subject
 * blocks cover most of the canvas). Otherwise the global pixel vote decides
 * - the photograph regime, which is expected to be noisy.
 */
export function detectDominantBackground(
  pixels: Uint8Array | Buffer,
  width: number,
  height: number,
): DominantColor {
  const thickness = Math.max(
    1,
    Math.round(Math.min(width, height) * BORDER_THICKNESS_RATIO),
  );
  const borderIndices: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < thickness || y < thickness || x >= width - thickness || y >= height - thickness) {
        borderIndices.push(y * width + x);
      }
    }
  }
  const border = voteDominantBin(pixels, borderIndices);
  if (
    border.bin !== null &&
    border.total > 0 &&
    border.bin.count / border.total >= BORDER_BACKGROUND_COVERAGE
  ) {
    return binMeanColor(border.bin);
  }
  const global = voteDominantBin(pixels, null);
  if (global.bin === null) {
    return { r: 0, g: 0, b: 0 };
  }
  return binMeanColor(global.bin);
}

/**
 * Foreground mask of a raw sRGB raster against a background color: a pixel is
 * foreground iff its Euclidean RGB distance from the background exceeds the
 * threshold.
 */
export function buildForegroundMask(
  pixels: Uint8Array | Buffer,
  background: DominantColor,
  threshold: number = FOREGROUND_COLOR_DISTANCE,
): Uint8Array {
  const pixelCount = Math.floor(pixels.length / 3);
  const mask = new Uint8Array(pixelCount);
  const thresholdSquared = threshold * threshold;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const dr = pixels[pixel * 3] - background.r;
    const dg = pixels[pixel * 3 + 1] - background.g;
    const db = pixels[pixel * 3 + 2] - background.b;
    if (dr * dr + dg * dg + db * db > thresholdSquared) {
      mask[pixel] = 1;
    }
  }
  return mask;
}

export interface ConnectedBlockOptions {
  minAreaPixels?: number;
  maxBlocks?: number;
}

/**
 * Connected-component blocks of a binary mask (4-connectivity, iterative
 * flood fill): normalized bounding boxes, largest first, noise components
 * below minAreaPixels dropped, capped at maxBlocks. Pixels that only touch at
 * a corner belong to different blocks.
 */
export function connectedComponentBlocks(
  mask: Uint8Array,
  width: number,
  height: number,
  options: ConnectedBlockOptions = {},
): DetectedBlock[] {
  const minAreaPixels = options.minAreaPixels ?? MIN_BLOCK_AREA_PIXELS;
  const maxBlocks = options.maxBlocks ?? MAX_DETECTED_BLOCKS;
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const blocks: Array<DetectedBlock & { area: number }> = [];

  for (let seed = 0; seed < mask.length; seed += 1) {
    if (mask[seed] === 0 || visited[seed] === 1) {
      continue;
    }
    let stackSize = 0;
    stack[stackSize++] = seed;
    visited[seed] = 1;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let area = 0;
    while (stackSize > 0) {
      const index = stack[--stackSize];
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
      // 4-connectivity: orthogonal neighbors only.
      if (x > 0 && mask[index - 1] === 1 && visited[index - 1] === 0) {
        visited[index - 1] = 1;
        stack[stackSize++] = index - 1;
      }
      if (
        x + 1 < width &&
        mask[index + 1] === 1 &&
        visited[index + 1] === 0
      ) {
        visited[index + 1] = 1;
        stack[stackSize++] = index + 1;
      }
      if (y > 0 && mask[index - width] === 1 && visited[index - width] === 0) {
        visited[index - width] = 1;
        stack[stackSize++] = index - width;
      }
      if (
        y + 1 < height &&
        mask[index + width] === 1 &&
        visited[index + width] === 0
      ) {
        visited[index + width] = 1;
        stack[stackSize++] = index + width;
      }
    }
    if (area >= minAreaPixels) {
      blocks.push({
        x: minX / width,
        y: minY / height,
        width: (maxX - minX + 1) / width,
        height: (maxY - minY + 1) / height,
        area,
      });
    }
  }
  return blocks
    .sort((a, b) => b.area - a.area)
    .slice(0, maxBlocks)
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
}

/**
 * Detects the reference image's foreground blocks (normalized boxes, largest
 * first): sharp decodes the pixels at a bounded working resolution, the
 * dominant color is treated as the background, and foreground pixels group
 * into 4-connected components. Pure pixel logic - no model, no network.
 */
export async function detectReferenceBlocks(
  buffer: Buffer,
  mimeType: string,
): Promise<DetectedBlock[]> {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("detectReferenceBlocks expects an image Buffer");
  }
  if (typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
    throw new TypeError(
      `Unsupported mimeType for block detection: ${String(mimeType)}`,
    );
  }
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({
      width: SELF_CHECK_WORKING_MAX_DIMENSION,
      height: SELF_CHECK_WORKING_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .toColorspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width < 1 || info.height < 1 || info.channels < 3) {
    return [];
  }
  // sharp's raw data is a Buffer, which already is a Uint8Array.
  const background = detectDominantBackground(data, info.width, info.height);
  const mask = buildForegroundMask(data, background);
  const minArea = Math.max(
    MIN_BLOCK_AREA_PIXELS,
    Math.ceil(MIN_BLOCK_AREA_RATIO * info.width * info.height),
  );
  return connectedComponentBlocks(mask, info.width, info.height, {
    minAreaPixels: minArea,
  });
}

// ---------------------------------------------------------------------------
// Deterministic geometry: recipe -> slot boxes (fake square gray assets)
// ---------------------------------------------------------------------------

/**
 * Compiles a recipe into its layout slot boxes using fake assets: one 1:1
 * gray image analysis per slot, bound round-robin to the compiled slots. The
 * first pass learns the generated slot ids, the second re-compiles with the
 * assets bound so crop intents resolve against the fake analyses too; slot
 * rectangles are identical in both passes (crops never move a slot). The
 * full-canvas background slot of layered-collage is excluded - it is the
 * canvas, not a collage block.
 */
export function compileRecipeSlotRects(
  recipe: TemplateRecipe,
  width: number,
  height: number,
): DetectedBlock[] {
  const slotCount = Math.min(
    recipe.family === "diagonal-collage"
      ? recipe.supportCount + 2
      : recipe.supportCount + 1,
    6,
  );
  if (slotCount < 2) {
    return [];
  }
  const ratioId = reducedRatioId(width, height);
  const first = compileTemplateRecipe({
    recipe,
    ratioId,
    width,
    height,
    assetCount: slotCount,
  });
  const slotAssignments: Record<string, string> = {};
  first.slots.forEach((slot, index) => {
    slotAssignments[slot.id] = `fake-${(index % slotCount) + 1}`;
  });
  const compiled = compileTemplateRecipe({
    recipe,
    ratioId,
    width,
    height,
    assetCount: slotCount,
    assets: fakeGrayAssets(slotCount),
    slotAssignments,
  });
  return compiled.slots
    .filter((slot: TemplateSlot) => slot.role !== "background")
    .map((slot) => ({
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
    }));
}

function fakeGrayAssets(count: number): ImageAssetAnalysis[] {
  return Array.from({ length: count }, (_, index) => ({
    assetId: `fake-${index + 1}`,
    width: 1024,
    height: 1024,
    orientation: "square" as const,
    aspectRatio: 1,
    resolutionScore: 1,
    dominantColors: ["#808080", "#7d7d7d", "#838383"],
    averageColor: "#808080",
    brightness: 0.5,
    saturation: 0,
    contrast: 0.1,
  }));
}

function reducedRatioId(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

/**
 * Average best-match IoU between the compiled slot boxes and the detected
 * reference blocks: every slot scores its best IoU against any block, and the
 * per-slot scores average. Zero when either list is empty. Reuses the exact
 * boxIoU from the local vision layer.
 */
export function averageBestMatchIoU(
  slotRects: DetectedBlock[],
  blocks: DetectedBlock[],
): number {
  if (slotRects.length === 0 || blocks.length === 0) {
    return 0;
  }
  const total = slotRects.reduce(
    (sum, rect) =>
      sum + Math.max(...blocks.map((block) => boxIoU(rect, block))),
    0,
  );
  return total / slotRects.length;
}

// ---------------------------------------------------------------------------
// VLM call (moonpulse relay, OpenAI-compatible)
// ---------------------------------------------------------------------------

const REVERSE_MAX_DIMENSION = 1536;

async function buildReferenceImageUrl(
  referenceImage: ReverseEngineerImage,
): Promise<string> {
  const { buffer, mimeType, width, height } = referenceImage;
  if (width <= REVERSE_MAX_DIMENSION && height <= REVERSE_MAX_DIMENSION) {
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }
  const resized = await sharp(buffer)
    .resize({
      width: width >= height ? REVERSE_MAX_DIMENSION : undefined,
      height: height > width ? REVERSE_MAX_DIMENSION : undefined,
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${resized.toString("base64")}`;
}

async function requestReverseCompletion(
  client: OpenAI,
  config: StyleReverseModelConfig,
  imageUrl: string,
  prompt: string,
): Promise<string> {
  const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: config.model,
    messages: [
      { role: "system", content: STYLE_REVERSE_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
        ],
      },
    ],
  };
  // glm-5v-turbo style relays ignore response_format, so the JSON-only
  // contract lives in the prompt text itself.
  const content = config.streaming
    ? await streamCompletionContent(client, body)
    : await bufferCompletionContent(client, body);
  return content;
}

/**
 * Normalizes a non-streamed assistant message content to plain text. The SDK
 * response types say string | null, but relays also answer with the segmented
 * content-part array form ({type:"text"} parts); an unnormalized array would
 * TypeError inside extractJsonValue and burn the validation retry. Text parts
 * concatenate in order; every other shape collapses to "" so the
 * empty-response error below still fires.
 */
function messageContentToText(
  content: string | Array<{ type: string; text?: string }> | null | undefined,
): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

async function bufferCompletionContent(
  client: OpenAI,
  body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<string> {
  const completion = await client.chat.completions.create(body);
  const message = completion.choices[0]?.message;
  const content = messageContentToText(message?.content);
  if (!content) {
    throw new StyleReverseError(
      "invalid_response",
      message?.refusal || "Reverse model returned an empty response",
    );
  }
  return content;
}

async function streamCompletionContent(
  client: OpenAI,
  body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<string> {
  const stream = await client.chat.completions.create({ ...body, stream: true });
  let content = "";
  // Reasoning deltas are not part of the recipe payload; only content deltas
  // accumulate (same rule as the planning provider).
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta && typeof delta.content === "string") {
      content += delta.content;
    }
  }
  if (!content) {
    throw new StyleReverseError(
      "invalid_response",
      "Reverse model returned an empty streamed response",
    );
  }
  return content;
}

function formatValidationIssues(error: unknown): string {
  return error instanceof z.ZodError
    ? error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")
    : error instanceof Error
      ? error.message
      : String(error);
}

export interface ReverseEngineerOptions {
  /** Environment override; defaults to process.env. */
  environment?: Record<string, string | undefined>;
  /** Injected OpenAI-compatible client (tests); defaults to a new relay client. */
  client?: OpenAI;
}

/**
 * Reverse-engineers a reference collage image into a TemplateRecipe:
 *
 * 1. deterministic block detection on the reference pixels (sharp only);
 * 2. one VLM call inferring recipe + styleNotes + confidence (zod-validated,
 *    retried exactly once with the validation error appended on failure);
 * 3. the validated recipe compiles with fake square gray assets into slot
 *    boxes, scored against the detected blocks as average best-match IoU.
 *
 * Photograph references are expected to be noisy in step 3; the score is
 * reported as measured. Throws StyleReverseError("configuration") without
 * LLM_API_KEY, and StyleReverseError("invalid_response") when the retry still
 * fails schema validation.
 */
export async function reverseEngineer(
  referenceImage: ReverseEngineerImage,
  hint?: ReverseHint,
  options: ReverseEngineerOptions = {},
): Promise<ReverseResult> {
  if (!Buffer.isBuffer(referenceImage.buffer)) {
    throw new TypeError("reverseEngineer expects an image Buffer");
  }
  if (
    typeof referenceImage.mimeType !== "string" ||
    !referenceImage.mimeType.startsWith("image/")
  ) {
    throw new TypeError(
      `Unsupported mimeType for reverse engineering: ${String(referenceImage.mimeType)}`,
    );
  }
  if (
    !Number.isFinite(referenceImage.width) ||
    !Number.isFinite(referenceImage.height) ||
    referenceImage.width < 1 ||
    referenceImage.height < 1
  ) {
    throw new TypeError("reverseEngineer expects positive image dimensions");
  }

  const environment = options.environment ?? process.env;
  const config = loadStyleReverseModelConfig(environment);
  if (config === null) {
    throw new StyleReverseError(
      "configuration",
      "Style reverse engineering requires LLM_API_KEY to be configured",
    );
  }
  const client =
    options.client ??
    new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      maxRetries: 0,
    });

  const warnings: string[] = [];
  const detectedBlocks = await detectReferenceBlocks(
    referenceImage.buffer,
    referenceImage.mimeType,
  );
  if (detectedBlocks.length === 0) {
    warnings.push(
      "No foreground blocks detected in the reference image; the geometry self-check will score 0 (photograph references are expected to be noisy)",
    );
  }

  const imageUrl = await buildReferenceImageUrl(referenceImage);
  const basePrompt = createReversePrompt({
    width: referenceImage.width,
    height: referenceImage.height,
    ...(hint ? { hint } : {}),
  });

  let content = await requestReverseCompletion(client, config, imageUrl, basePrompt);
  let parsed: z.infer<typeof reverseResponseSchema>;
  try {
    parsed = reverseResponseSchema.parse(extractJsonValue(content));
  } catch (error) {
    warnings.push(
      `VLM response failed schema validation (${formatValidationIssues(error)}); retried once with the error appended`,
    );
    const retryPrompt = createReversePrompt({
      width: referenceImage.width,
      height: referenceImage.height,
      ...(hint ? { hint } : {}),
      validationError: error,
    });
    content = await requestReverseCompletion(client, config, imageUrl, retryPrompt);
    try {
      parsed = reverseResponseSchema.parse(extractJsonValue(content));
    } catch (retryError) {
      throw new StyleReverseError(
        "invalid_response",
        `Reverse model returned an invalid recipe after one retry: ${formatValidationIssues(retryError)}`,
        { cause: retryError },
      );
    }
  }

  const slotRects = compileRecipeSlotRects(
    parsed.recipe,
    referenceImage.width,
    referenceImage.height,
  );
  const selfCheckIoU = Number(
    averageBestMatchIoU(slotRects, detectedBlocks).toFixed(4),
  );
  if (selfCheckIoU < 0.5) {
    warnings.push(
      `Geometry self-check IoU ${selfCheckIoU} is below the 0.5 target; pass this result as a hint to re-reverse the reference`,
    );
  }

  return {
    recipe: parsed.recipe,
    styleNotes: parsed.styleNotes,
    confidence: parsed.confidence,
    warnings,
    detectedBlocks,
    selfCheckIoU,
  };
}
