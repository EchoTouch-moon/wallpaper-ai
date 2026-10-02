import OpenAI from "openai";
import { z } from "zod";

import {
  normalizedBoxSchema,
  normalizedPointSchema,
} from "../../packages/core/src/layout/layoutSchema.ts";
import type { ImageAssetAnalysis } from "../../packages/core/src/types/layout.ts";

// Subject contour contract: a 24x24 occupancy grid (1 = subject cell) plus an
// optional simplified polygon for single-subject images.
const CONTOUR_GRID_SIZE = 24;
const CONTOUR_GRID_CELLS = CONTOUR_GRID_SIZE * CONTOUR_GRID_SIZE; // 576
const CONTOUR_MAX_POLYGON_VERTICES = 48;
const CONTOUR_GRID_PATTERN = new RegExp(`^[01]{${CONTOUR_GRID_CELLS}}$`);

const subjectContourSchema = z
  .object({
    grid: z.string().regex(CONTOUR_GRID_PATTERN),
    gridSize: z.literal(CONTOUR_GRID_SIZE),
    subjectPolygon: z
      .array(normalizedPointSchema)
      .min(3)
      .max(CONTOUR_MAX_POLYGON_VERTICES)
      .optional(),
    subjectAreaRatio: z.number().min(0).max(1),
  })
  .strict();

export type SubjectContour = z.infer<typeof subjectContourSchema>;

const visionAnalysisPatchSchema = z
  .object({
    contentType: z.enum([
      "portrait",
      "landscape",
      "anime",
      "pet",
      "architecture",
      "object",
      "text-heavy",
      "unknown",
    ]),
    faces: z.array(normalizedBoxSchema).max(12),
    subjectBox: normalizedBoxSchema.nullable(),
    subjectContour: subjectContourSchema.optional(),
    saliencyCenter: normalizedPointSchema,
    styleTags: z.array(z.string().trim().min(1).max(32)).max(8),
    bestUse: z
      .array(
        z.enum([
          "hero",
          "background",
          "support",
          "triptych",
          "portrait-collage",
          "irregular-collage",
        ]),
      )
      .min(1)
      .max(6),
    cropSafety: z.enum(["high", "medium", "low"]),
  })
  .strict();

export type VisionAnalysisPatch = z.infer<
  typeof visionAnalysisPatchSchema
>;

const CONTENT_TYPE_VALUES: readonly string[] = [
  "portrait",
  "landscape",
  "anime",
  "pet",
  "architecture",
  "object",
  "text-heavy",
  "unknown",
];

const BEST_USE_VALUES: readonly string[] = [
  "hero",
  "background",
  "support",
  "triptych",
  "portrait-collage",
  "irregular-collage",
];

// Soft degradations that still produced a usable patch (e.g. the
// empty-detection retry succeeded on the second call) are surfaced here so
// callers can record them in their own analysisWarnings channel instead of
// losing the signal; hard failures keep throwing.
export interface VisionAnalysisResult extends VisionAnalysisPatch {
  analysisWarnings: string[];
}

export interface VisionAnalysisInput {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  basicAnalysis: ImageAssetAnalysis;
}

export interface VisionProvider {
  analyze(input: VisionAnalysisInput): Promise<VisionAnalysisResult>;
}

interface VisionProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  timeoutMs: number;
}

const VISION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "contentType",
    "faces",
    "subjectBox",
    "saliencyCenter",
    "styleTags",
    "bestUse",
    "cropSafety",
    "subjectContour",
  ],
  properties: {
    contentType: {
      type: "string",
      enum: [
        "portrait",
        "landscape",
        "anime",
        "pet",
        "architecture",
        "object",
        "text-heavy",
        "unknown",
      ],
    },
    faces: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["x", "y", "width", "height"],
        properties: {
          x: { type: "number", minimum: 0, maximum: 1 },
          y: { type: "number", minimum: 0, maximum: 1 },
          width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        },
      },
    },
    subjectBox: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["x", "y", "width", "height"],
          properties: {
            x: { type: "number", minimum: 0, maximum: 1 },
            y: { type: "number", minimum: 0, maximum: 1 },
            width: { type: "number", exclusiveMinimum: 0, maximum: 1 },
            height: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          },
        },
        { type: "null" },
      ],
    },
    saliencyCenter: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: {
        x: { type: "number", minimum: 0, maximum: 1 },
        y: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    styleTags: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    bestUse: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "string",
        enum: [
          "hero",
          "background",
          "support",
          "triptych",
          "portrait-collage",
          "irregular-collage",
        ],
      },
    },
    cropSafety: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    // Optional at the semantic level: strict JSON-schema mode requires every
    // property to be listed, so optionality is expressed as anyOf + null.
    subjectContour: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["grid", "gridSize", "subjectPolygon", "subjectAreaRatio"],
          properties: {
            grid: {
              type: "string",
              pattern: "^[01]{576}$",
              description:
                "24x24 occupancy grid flattened row-major: exactly 576 characters of 0/1, 1 = subject cell",
            },
            gridSize: { type: "integer", enum: [24] },
            subjectPolygon: {
              anyOf: [
                {
                  type: "array",
                  maxItems: 48,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["x", "y"],
                    properties: {
                      x: { type: "number", minimum: 0, maximum: 1 },
                      y: { type: "number", minimum: 0, maximum: 1 },
                    },
                  },
                },
                { type: "null" },
              ],
            },
            subjectAreaRatio: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        { type: "null" },
      ],
    },
  },
} as const;

// Native detection entries returned by relays that ignore response_format,
// e.g. glm-5v-turbo: { box_2d: [x1, y1, x2, y2], label: "background" }.
const detectionEntrySchema = z.object({
  box_2d: z.tuple([
    z.number(),
    z.number(),
    z.number(),
    z.number(),
  ]),
  label: z.string(),
});

type DetectionEntry = z.infer<typeof detectionEntrySchema>;

function isDetectionArray(value: unknown): value is DetectionEntry[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => detectionEntrySchema.safeParse(entry).success)
  );
}

// An array response that carries no usable box_2d entry (empty array, or
// entries that do not match the detection shape) is the intermittently
// observed relay failure this provider retries once before degrading.
function isEmptyDetectionArray(value: unknown): boolean {
  return Array.isArray(value) && !isDetectionArray(value);
}

// box_2d is [x1, y1, x2, y2] in normalized 0-1 coordinates; clamp so the
// mapped box always satisfies the normalized box schema.
function box2dToNormalizedBox([
  x1,
  y1,
  x2,
  y2,
]: DetectionEntry["box_2d"]): { x: number; y: number; width: number; height: number } {
  const left = Math.min(Math.max(x1, 0), 1);
  const top = Math.min(Math.max(y1, 0), 1);
  const right = Math.min(Math.max(x2, 0), 1);
  const bottom = Math.min(Math.max(y2, 0), 1);
  return {
    x: left,
    y: top,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

function boxArea(box: { width: number; height: number }) {
  return box.width * box.height;
}

const FACE_LABEL_KEYWORDS = ["face", "person", "head", "portrait"];

// Conservative contentType derivation thresholds for the detection-array
// shape, which carries no semantic type of its own.
const PORTRAIT_ASPECT_MAX = 0.9; // width/height below this reads as a vertical box
const LANDSCAPE_ASPECT_MIN = 1.1; // width/height above this reads as a horizontal box
const LANDSCAPE_MIN_SPAN = 0.6; // horizontal box spanning >=60% of the frame width reads as scenery

// Detection arrays cannot express contentType directly, so derive it
// conservatively: a labelled face always wins (portrait), then the subject
// box aspect ratio decides (vertical -> portrait, wide full-span ->
// landscape, wide partial -> object); anything ambiguous stays "unknown".
function deriveContentType(
  subjectBox: { width: number; height: number } | null,
  faces: unknown[],
): VisionAnalysisPatch["contentType"] {
  if (faces.length > 0) {
    return "portrait";
  }
  if (!subjectBox) {
    return "unknown";
  }
  const aspect = subjectBox.width / subjectBox.height;
  if (aspect < PORTRAIT_ASPECT_MAX) {
    return "portrait";
  }
  if (aspect > LANDSCAPE_ASPECT_MIN) {
    return subjectBox.width >= LANDSCAPE_MIN_SPAN ? "landscape" : "object";
  }
  return "unknown";
}

// Existing derivation kept as the base (subject -> hero+background, otherwise
// background), extended so a derived portrait subject also fits collage use.
function deriveBestUse(
  contentType: VisionAnalysisPatch["contentType"],
  subjectBox: { width: number; height: number } | null,
): VisionAnalysisPatch["bestUse"] {
  const uses: VisionAnalysisPatch["bestUse"] = subjectBox
    ? ["hero", "background"]
    : ["background"];
  if (subjectBox && contentType === "portrait") {
    uses.push("portrait-collage");
  }
  return uses;
}

// Existing derivation kept as the base (faces -> low, otherwise medium),
// extended so a derived portrait without a labelled face is still treated
// cautiously: a tall subject may be an undetected person, so cropping risk
// stays "low" rather than assuming medium safety.
function deriveCropSafety(
  contentType: VisionAnalysisPatch["contentType"],
  faces: unknown[],
): VisionAnalysisPatch["cropSafety"] {
  if (faces.length > 0 || contentType === "portrait") {
    return "low";
  }
  return "medium";
}

// Maps a native detection array onto the semantic patch contract. The largest
// subject-labelled box becomes subjectBox; remaining face/person boxes become
// faces (max 12). The detection shape cannot express styleTags, so they stay
// empty; contentType/bestUse/cropSafety are derived conservatively from the
// mapped boxes so the merged analysis still validates.
function detectionArrayToVisionPatch(
  detections: DetectionEntry[],
): VisionAnalysisPatch {
  const labelled = detections
    .map((detection) => ({
      label: detection.label.trim().toLowerCase(),
      box: box2dToNormalizedBox(detection.box_2d),
    }))
    .filter((entry) => entry.box.width > 0 && entry.box.height > 0);

  const subjectCandidates = labelled.filter(
    (entry) => entry.label.includes("subject"),
  );
  const subjectEntry =
    subjectCandidates.length > 0
      ? subjectCandidates.reduce((largest, entry) =>
          boxArea(entry.box) > boxArea(largest.box) ? entry : largest,
        )
      : null;

  const faces = labelled
    .filter(
      (entry) =>
        entry !== subjectEntry &&
        FACE_LABEL_KEYWORDS.some((keyword) => entry.label.includes(keyword)),
    )
    .sort((a, b) => boxArea(b.box) - boxArea(a.box))
    .slice(0, 12)
    .map((entry) => entry.box);

  const subjectBox = subjectEntry ? subjectEntry.box : null;
  const saliencyCenter = subjectBox
    ? {
        x: subjectBox.x + subjectBox.width / 2,
        y: subjectBox.y + subjectBox.height / 2,
      }
    : { x: 0.5, y: 0.5 };

  const contentType = deriveContentType(subjectBox, faces);
  return {
    contentType,
    faces,
    subjectBox,
    saliencyCenter,
    styleTags: [],
    bestUse: deriveBestUse(contentType, subjectBox),
    cropSafety: deriveCropSafety(contentType, faces),
  };
}

function extractJsonValue(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced ?? trimmed;
  // A top-level detection array must be extracted whole: brace-slicing a
  // single-entry array would silently return its inner object instead.
  if (source.startsWith("[")) {
    const arrayEnd = source.lastIndexOf("]");
    if (arrayEnd > 0) {
      try {
        return JSON.parse(source.slice(0, arrayEnd + 1)) as unknown;
      } catch (error) {
        throw new Error(
          `Vision model returned unparseable JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  const objectStart = source.indexOf("{");
  const objectEnd = source.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(source.slice(objectStart, objectEnd + 1)) as unknown;
    } catch {
      // An array payload makes the brace slice span multiple top-level
      // values; fall through and retry with bracket delimiters.
    }
  }
  const arrayStart = source.indexOf("[");
  const arrayEnd = source.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(source.slice(arrayStart, arrayEnd + 1)) as unknown;
    } catch (error) {
      throw new Error(
        `Vision model returned unparseable JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  throw new Error(
    "Vision model returned no JSON object or detection array",
  );
}

function parseVisionResponse(value: unknown): {
  patch: VisionAnalysisPatch;
  warnings: string[];
} {
  if (isDetectionArray(value)) {
    return {
      patch: visionAnalysisPatchSchema.parse(detectionArrayToVisionPatch(value)),
      warnings: [],
    };
  }
  if (Array.isArray(value)) {
    throw new Error(
      "Vision model returned an array without usable box_2d detection entries",
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Vision model returned neither an object nor an array");
  }
  const normalized = normalizeObjectPatch(value as Record<string, unknown>);
  if (normalized === null) {
    throw new Error(
      "Vision model returned an object without usable semantic fields",
    );
  }
  return { patch: visionAnalysisPatchSchema.parse(normalized.patch), warnings: normalized.warnings };
}

// Models asked for the full object still drift from the JSON schema in
// predictable ways (subjectBox/saliencyCenter as bare coordinate arrays,
// free-form contentType strings, comma-joined styleTags). Normalize those
// shapes before the strict parse; anything unrecognizable falls back to the
// same conservative derivations the detection-array path uses, so a usable
// patch survives instead of degrading the whole analysis to basic.
function coerceNormalizedBox(value: unknown) {
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return box2dToNormalizedBox(value as DetectionEntry["box_2d"]);
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.x === "number" &&
      typeof candidate.y === "number" &&
      typeof candidate.width === "number" &&
      typeof candidate.height === "number" &&
      [candidate.x, candidate.y, candidate.width, candidate.height].every((n) =>
        Number.isFinite(n),
      )
    ) {
      // Clamp each field directly: routing a valid box through x + width
      // would introduce floating-point drift (0.1 + 0.2) and break the
      // byte-identical passthrough of already-valid patches.
      return {
        x: Math.min(Math.max(candidate.x, 0), 1),
        y: Math.min(Math.max(candidate.y, 0), 1),
        width: Math.min(Math.max(candidate.width, 0), 1),
        height: Math.min(Math.max(candidate.height, 0), 1),
      };
    }
  }
  return null;
}

function coerceNormalizedPoint(value: unknown) {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    const [x, y] = value as [number, number];
    return {
      x: Math.min(Math.max(x, 0), 1),
      y: Math.min(Math.max(y, 0), 1),
    };
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.x === "number" &&
      typeof candidate.y === "number" &&
      Number.isFinite(candidate.x) &&
      Number.isFinite(candidate.y)
    ) {
      return {
        x: Math.min(Math.max(candidate.x, 0), 1),
        y: Math.min(Math.max(candidate.y, 0), 1),
      };
    }
  }
  return null;
}

// Occupancy ratio of a repaired/valid grid: share of cells marked 1.
function gridOccupancyRatio(grid: string): number {
  let occupied = 0;
  for (const cell of grid) {
    if (cell === "1") {
      occupied += 1;
    }
  }
  return occupied / CONTOUR_GRID_CELLS;
}

// Row-wise repair for drifted grids (length != 576, stray whitespace, line
// breaks, non-0/1 characters). Line breaks preserve the model's row
// boundaries: each row keeps only its 0/1 characters, is trimmed to 24 cells
// and padded with 0; missing rows are all-zero. A single-line grid (no row
// boundaries available) is re-chunked sequentially into 24 rows. Returns null
// only when there is no usable 0/1 character at all.
function repairContourGrid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const lineRows = value
    .split(/\r?\n/)
    .map((row) => row.replace(/[^01]/g, ""))
    .filter((row) => row.length > 0);
  if (lineRows.length === 0) {
    return null;
  }
  const flat = lineRows.join("");
  if (flat.length === 0) {
    return null;
  }
  const rows: string[] = [];
  for (let row = 0; row < CONTOUR_GRID_SIZE; row += 1) {
    if (lineRows.length > 1) {
      const cells = lineRows[row] ?? "";
      rows.push(
        cells.slice(0, CONTOUR_GRID_SIZE).padEnd(CONTOUR_GRID_SIZE, "0"),
      );
    } else {
      rows.push(
        flat
          .slice(row * CONTOUR_GRID_SIZE, (row + 1) * CONTOUR_GRID_SIZE)
          .padEnd(CONTOUR_GRID_SIZE, "0"),
      );
    }
  }
  return rows.join("");
}

// Conservative fallback grid for an unusable contour: every cell whose center
// falls inside the subject box is marked 1, everything else 0.
function conservativeGridFromSubjectBox(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  const rows: string[] = [];
  for (let row = 0; row < CONTOUR_GRID_SIZE; row += 1) {
    const centerY = (row + 0.5) / CONTOUR_GRID_SIZE;
    let line = "";
    for (let col = 0; col < CONTOUR_GRID_SIZE; col += 1) {
      const centerX = (col + 0.5) / CONTOUR_GRID_SIZE;
      const inside =
        centerX >= box.x &&
        centerX <= box.x + box.width &&
        centerY >= box.y &&
        centerY <= box.y + box.height;
      line += inside ? "1" : "0";
    }
    rows.push(line);
  }
  return rows.join("");
}

// Accepts both polygon shapes models drift between — [{x, y}] objects and
// [[x, y]] arrays — reusing the point coercion (which clamps 0-1). Illegal
// points are dropped; fewer than 3 survivors means no polygon at all.
function coerceSubjectPolygon(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }
  const points = value
    .map((point) => coerceNormalizedPoint(point))
    .filter(
      (point): point is { x: number; y: number } => point !== null,
    )
    .slice(0, CONTOUR_MAX_POLYGON_VERTICES);
  return points.length >= 3 ? points : null;
}

const CONTOUR_GRID_REPAIRED_WARNING =
  "Vision subjectContour grid was malformed; repaired row-wise to a 24x24 grid";
const CONTOUR_GRID_FALLBACK_WARNING =
  "Vision subjectContour grid was unusable; generated a conservative all-inside-subjectBox grid instead";
const CONTOUR_GRID_OMITTED_WARNING =
  "Vision subjectContour grid was unusable and no subjectBox was available; subjectContour omitted";

function normalizeSubjectContour(
  value: unknown,
  subjectBox: ReturnType<typeof coerceNormalizedBox>,
): { contour: SubjectContour | undefined; warnings: string[] } {
  if (typeof value !== "object" || value === null) {
    return { contour: undefined, warnings: [] };
  }
  const candidate = value as Record<string, unknown>;
  const warnings: string[] = [];

  let grid: string | null;
  if (
    typeof candidate.grid === "string" &&
    CONTOUR_GRID_PATTERN.test(candidate.grid)
  ) {
    // A fully valid grid is taken byte-identical, like every other valid
    // field in the object path.
    grid = candidate.grid;
  } else {
    grid = repairContourGrid(candidate.grid);
    if (grid !== null) {
      warnings.push(CONTOUR_GRID_REPAIRED_WARNING);
    }
  }

  if (grid === null) {
    if (subjectBox !== null) {
      grid = conservativeGridFromSubjectBox(subjectBox);
      warnings.push(CONTOUR_GRID_FALLBACK_WARNING);
    } else {
      warnings.push(CONTOUR_GRID_OMITTED_WARNING);
      return { contour: undefined, warnings };
    }
  }

  const subjectPolygon = coerceSubjectPolygon(candidate.subjectPolygon);

  const subjectAreaRatio =
    typeof candidate.subjectAreaRatio === "number" &&
    Number.isFinite(candidate.subjectAreaRatio)
      ? Math.min(Math.max(candidate.subjectAreaRatio, 0), 1)
      : gridOccupancyRatio(grid);

  return {
    contour: {
      grid,
      gridSize: CONTOUR_GRID_SIZE,
      ...(subjectPolygon !== null ? { subjectPolygon } : {}),
      subjectAreaRatio,
    },
    warnings,
  };
}

function normalizeObjectPatch(value: Record<string, unknown>): {
  patch: VisionAnalysisPatch;
  warnings: string[];
} | null {
  const faces = (Array.isArray(value.faces) ? value.faces : [])
    .map((entry) => coerceNormalizedBox(entry))
    .filter(
      (box): box is NonNullable<ReturnType<typeof coerceNormalizedBox>> =>
        box !== null && box.width > 0 && box.height > 0,
    )
    .slice(0, 12);

  const subjectBoxCoerced = coerceNormalizedBox(value.subjectBox);
  const subjectBox =
    subjectBoxCoerced !== null &&
    subjectBoxCoerced.width > 0 &&
    subjectBoxCoerced.height > 0
      ? subjectBoxCoerced
      : null;

  const subjectContour = normalizeSubjectContour(
    value.subjectContour,
    subjectBox,
  );

  const contentTypeRaw =
    typeof value.contentType === "string"
      ? value.contentType.trim().toLowerCase()
      : "";
  const contentTypeValid = [...CONTENT_TYPE_VALUES].includes(contentTypeRaw);
  const contentType = contentTypeValid
    ? (contentTypeRaw as VisionAnalysisPatch["contentType"])
    : deriveContentType(subjectBox, faces);

  const styleTagsSource = Array.isArray(value.styleTags)
    ? value.styleTags
    : typeof value.styleTags === "string"
      ? value.styleTags.split(/[,;，；]/)
      : [];
  const styleTags = styleTagsSource
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 32)
    .slice(0, 8);

  const bestUseRaw = Array.isArray(value.bestUse)
    ? value.bestUse.filter(
        (use): use is string =>
          typeof use === "string" && BEST_USE_VALUES.includes(use),
      )
    : [];

  const cropSafetyRaw =
    typeof value.cropSafety === "string"
      ? value.cropSafety.trim().toLowerCase()
      : "";
  const cropSafetyValid = (["high", "medium", "low"] as const).includes(
    cropSafetyRaw as "high" | "medium" | "low",
  );

  // Salvage requires at least one usable signal; an object with none of the
  // semantic fields present is a failed response, not a patch to merge.
  if (
    subjectBox === null &&
    faces.length === 0 &&
    !contentTypeValid &&
    styleTags.length === 0 &&
    bestUseRaw.length === 0 &&
    !cropSafetyValid &&
    subjectContour.contour === undefined
  ) {
    return null;
  }

  const saliencyCenter =
    coerceNormalizedPoint(value.saliencyCenter) ??
    (subjectBox
      ? {
          x: subjectBox.x + subjectBox.width / 2,
          y: subjectBox.y + subjectBox.height / 2,
        }
      : { x: 0.5, y: 0.5 });

  const bestUse =
    bestUseRaw.length > 0
      ? (bestUseRaw.slice(0, 6) as VisionAnalysisPatch["bestUse"])
      : deriveBestUse(contentType, subjectBox);

  const cropSafety = cropSafetyValid
    ? (cropSafetyRaw as VisionAnalysisPatch["cropSafety"])
    : deriveCropSafety(contentType, faces);

  return {
    patch: {
      contentType,
      faces,
      subjectBox,
      saliencyCenter,
      styleTags,
      bestUse,
      cropSafety,
      ...(subjectContour.contour !== undefined
        ? { subjectContour: subjectContour.contour }
        : {}),
    },
    warnings: subjectContour.warnings,
  };
}

// Relays that ignore response_format only see the text prompt, so the output
// contract is spelled out there too: a single complete object, never a bare
// detection array, with every semantic field the patch schema requires.
const OUTPUT_CONTRACT_INSTRUCTION =
  "Answer with a single JSON object (never an array) containing contentType, faces (up to 12 face/head boxes, empty array when none), subjectBox, saliencyCenter, styleTags (up to 8 concise style tags), bestUse, cropSafety, and subjectContour (an object with grid: exactly 576 characters of 0/1 for a 24x24 row-major occupancy grid where 1 marks a subject cell, gridSize: 24, subjectPolygon: up to 48 normalized 0-1 vertices for a single subject or null, and subjectAreaRatio: 0-1), matching the provided JSON schema.";

// Appended on the one retry after an empty detection array, per the observed
// relay failure mode where the model returns no box at all when uncertain.
const SALIENT_SUBJECT_RETRY_INSTRUCTION =
  "You must output the single most salient subject box even if uncertain.";

const EMPTY_DETECTION_RETRY_NOTICE =
  "Vision detection array had no usable box_2d entries; retried once with an explicit salient-subject-box requirement";
const EMPTY_DETECTION_AFTER_RETRY_MESSAGE =
  "Vision model returned an array without usable box_2d detection entries after one retry with an explicit salient-subject-box requirement";

export class OpenAICompatibleVisionProvider implements VisionProvider {
  private readonly client: OpenAI;
  private readonly config: VisionProviderConfig;

  constructor(config: VisionProviderConfig, client?: OpenAI) {
    this.config = config;
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: config.timeoutMs,
        maxRetries: 0,
      });
  }

  async analyze(input: VisionAnalysisInput): Promise<VisionAnalysisResult> {
    const firstContent = await this.requestVisionCompletion(input);
    const firstValue = extractJsonValue(firstContent);
    if (!isEmptyDetectionArray(firstValue)) {
      const { patch, warnings } = parseVisionResponse(firstValue);
      return { ...patch, analysisWarnings: warnings };
    }

    // Observed relay behavior: the model answers with an array that carries
    // no usable detection entry. Retry exactly once with an explicit demand
    // for the most salient subject box; only a second empty array degrades
    // (throws, so callers fall back to basic analysis with a warning).
    const retryContent = await this.requestVisionCompletion(
      input,
      SALIENT_SUBJECT_RETRY_INSTRUCTION,
    );
    const retryValue = extractJsonValue(retryContent);
    if (isEmptyDetectionArray(retryValue)) {
      throw new Error(EMPTY_DETECTION_AFTER_RETRY_MESSAGE);
    }
    const { patch, warnings } = parseVisionResponse(retryValue);
    return {
      ...patch,
      analysisWarnings: [EMPTY_DETECTION_RETRY_NOTICE, ...warnings],
    };
  }

  private async requestVisionCompletion(
    input: VisionAnalysisInput,
    extraInstruction?: string,
  ) {
    const instructions = [
      OUTPUT_CONTRACT_INSTRUCTION,
      ...(extraInstruction ? [extraInstruction] : []),
    ].join(" ");
    const completion = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        {
          role: "system",
          content:
            "Analyze wallpaper composition only. Return normalized 0-1 boxes and JSON only. Never identify a person.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                JSON.stringify({
                  task:
                    "Find composition-safe semantic regions for automatic wallpaper layout.",
                  width: input.width,
                  height: input.height,
                  basicAnalysis: input.basicAnalysis,
                }) + `\n${instructions}`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.mimeType};base64,${input.buffer.toString("base64")}`,
                detail: "low",
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "wallpaper_vision_analysis",
          strict: true,
          schema: VISION_RESPONSE_SCHEMA,
        },
      },
    });
    const content = completion.choices[0]?.message.content;
    if (!content) {
      throw new Error("Vision model returned an empty response");
    }
    return content;
  }
}

export function createVisionProviderFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
) {
  if (environment.VISION_ENABLED !== "true") {
    return null;
  }
  const apiKey = environment.LLM_API_KEY?.trim();
  const model = environment.VISION_MODEL?.trim();
  if (!apiKey || !model) {
    return null;
  }
  // The contour-aware prompt (24x24 grid + polygon + face boxes) makes real
  // vision calls take 60s+ on fast vision models; 20s never completes.
  const timeout = Number(environment.VISION_TIMEOUT_MS ?? "90000");
  return new OpenAICompatibleVisionProvider({
    apiKey,
    baseURL: environment.LLM_BASE_URL?.trim() || undefined,
    model,
    timeoutMs:
      Number.isFinite(timeout) && timeout >= 1_000 ? timeout : 90_000,
  });
}

// The contour fields are not yet part of ImageAssetAnalysis (packages/core
// protocol), so the merged object carries them past the declared type: the
// zod imageAssetAnalysisSchema is non-strict and strips (not rejects) the
// extra key, keeping every existing merge/persist path behavior unchanged.
export function mergeVisionAnalysis(
  basic: ImageAssetAnalysis,
  patch: VisionAnalysisPatch & { analysisWarnings?: string[] },
): ImageAssetAnalysis & { subjectContour?: SubjectContour } {
  // analysisWarnings is the provider's observability channel, not a semantic
  // analysis field: strip it so the merged analysis stays schema-clean.
  const { analysisWarnings: _providerWarnings, ...semantic } = patch;
  return {
    ...basic,
    ...semantic,
    subjectBox: semantic.subjectBox ?? undefined,
    subjectContour: semantic.subjectContour ?? undefined,
  };
}
