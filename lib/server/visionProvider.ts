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

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced ?? trimmed;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Vision model returned no JSON object");
  }
  return JSON.parse(source.slice(start, end + 1)) as unknown;
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
    return visionAnalysisPatchSchema.parse(extractJsonObject(content));
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
