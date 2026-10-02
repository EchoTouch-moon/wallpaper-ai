import OpenAI from "openai";
import { z } from "zod";

import {
  normalizedBoxSchema,
  normalizedPointSchema,
} from "../../packages/core/src/layout/layoutSchema.ts";
import type { ImageAssetAnalysis } from "../../packages/core/src/types/layout.ts";

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

export interface VisionAnalysisInput {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  basicAnalysis: ImageAssetAnalysis;
}

export interface VisionProvider {
  analyze(input: VisionAnalysisInput): Promise<VisionAnalysisPatch>;
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

// Maps a native detection array onto the semantic patch contract. The largest
// subject-labelled box becomes subjectBox; remaining face/person boxes become
// faces (max 12). Fields the detection shape cannot express fall back to
// neutral values so the merged analysis still validates.
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

  return {
    contentType: "unknown",
    faces,
    subjectBox,
    saliencyCenter,
    styleTags: [],
    bestUse: subjectBox ? ["hero", "background"] : ["background"],
    cropSafety: faces.length > 0 ? "low" : "medium",
  };
}

function extractJsonValue(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced ?? trimmed;
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

function parseVisionResponse(value: unknown): VisionAnalysisPatch {
  if (isDetectionArray(value)) {
    return visionAnalysisPatchSchema.parse(detectionArrayToVisionPatch(value));
  }
  if (Array.isArray(value)) {
    throw new Error(
      "Vision model returned an array without usable box_2d detection entries",
    );
  }
  return visionAnalysisPatchSchema.parse(value);
}

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

  async analyze(input: VisionAnalysisInput) {
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
              text: JSON.stringify({
                task:
                  "Find composition-safe semantic regions for automatic wallpaper layout.",
                width: input.width,
                height: input.height,
                basicAnalysis: input.basicAnalysis,
              }),
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
    return parseVisionResponse(extractJsonValue(content));
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
  const timeout = Number(environment.VISION_TIMEOUT_MS ?? "20000");
  return new OpenAICompatibleVisionProvider({
    apiKey,
    baseURL: environment.LLM_BASE_URL?.trim() || undefined,
    model,
    timeoutMs:
      Number.isFinite(timeout) && timeout >= 1_000 ? timeout : 20_000,
  });
}

export function mergeVisionAnalysis(
  basic: ImageAssetAnalysis,
  patch: VisionAnalysisPatch,
): ImageAssetAnalysis {
  return {
    ...basic,
    ...patch,
    subjectBox: patch.subjectBox ?? undefined,
  };
}
