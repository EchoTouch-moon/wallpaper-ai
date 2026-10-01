import OpenAI from "openai";
import { ZodError } from "zod";

import { aiLayoutPlanResponseSchema } from "./aiPlanSchema.ts";
import {
  AI_LAYOUT_PLAN_JSON_SCHEMA,
  createLayoutPlanMessages,
  createPlanningRequestMessages,
  createPlanningRequestContentParts,
  VISION_PLANNING_SYSTEM_ADDENDUM,
  type PlanningContentPart,
} from "./layoutPlanPrompt.ts";
import { planningRequestV2Schema } from "./planningProtocol.ts";
import type {
  LayoutModelConfig,
  VisionPlanningModelConfig,
} from "./llmConfig.ts";
import type { PlanningRequest } from "./planningProtocol.ts";
import type {
  LayoutModelProvider,
  LayoutModelRequest,
  LegacyLayoutModelProvider,
} from "./provider.ts";

export type LayoutProviderErrorCode =
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "invalid_response"
  | "provider_error";

export class LayoutProviderError extends Error {
  readonly code: LayoutProviderErrorCode;

  constructor(code: LayoutProviderErrorCode, message: string) {
    super(message);
    this.name = "LayoutProviderError";
    this.code = code;
  }
}

export function classifyProviderError(error: unknown) {
  if (error instanceof LayoutProviderError) {
    return error;
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new LayoutProviderError("timeout", "Layout model request timed out");
  }
  if (error instanceof OpenAI.AuthenticationError) {
    return new LayoutProviderError(
      "authentication",
      "Layout model authentication failed",
    );
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new LayoutProviderError(
      "rate_limit",
      "Layout model rate limit exceeded",
    );
  }
  if (error instanceof OpenAI.APIError) {
    return new LayoutProviderError(
      "provider_error",
      `Layout model request failed with status ${error.status ?? "unknown"}`,
    );
  }
  if (typeof error === "object" && error !== null) {
    const status =
      "status" in error && typeof error.status === "number"
        ? error.status
        : null;
    const name =
      "name" in error && typeof error.name === "string" ? error.name : "";
    if (status === 401 || status === 403) {
      return new LayoutProviderError(
        "authentication",
        "Layout model authentication failed",
      );
    }
    if (status === 429) {
      return new LayoutProviderError(
        "rate_limit",
        "Layout model rate limit exceeded",
      );
    }
    if (name === "AbortError" || name.includes("Timeout")) {
      return new LayoutProviderError(
        "timeout",
        "Layout model request timed out",
      );
    }
    if (status !== null && status >= 500) {
      return new LayoutProviderError(
        "provider_error",
        `Layout model request failed with status ${status}`,
      );
    }
  }
  return new LayoutProviderError(
    "provider_error",
    error instanceof Error ? error.message : "Layout model request failed",
  );
}

export class OpenAICompatibleLayoutProvider
  implements LayoutModelProvider, LegacyLayoutModelProvider
{
  private readonly client: OpenAI;
  private readonly visionClient: OpenAI | null;
  private readonly config: LayoutModelConfig;

  constructor(config: LayoutModelConfig, client?: OpenAI) {
    this.config = config;
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: config.timeoutMs,
        maxRetries: 0,
      });
    // Multimodal planning calls target the VISION_* model identity when one
    // is configured. An injected client (tests) is shared for both calls.
    this.visionClient = client
      ? null
      : config.visionPlanning
        ? new OpenAI({
            apiKey: config.visionPlanning.apiKey,
            baseURL: config.visionPlanning.baseURL,
            timeout: config.visionPlanning.timeoutMs,
            maxRetries: 0,
          })
        : null;
  }

  async generatePlan(planning: PlanningRequest) {
    const parsed = planningRequestV2Schema.parse(planning);
    // Multimodal tier (plan/multimodal-planning-protocol-design.md §2.1/§2.4):
    // only when the VISION_PLANNING_ENABLED configuration resolved AND the
    // request carries asset content. Gate off, missing key, or empty
    // assetContent all keep the existing text-only message shape.
    const visionPlanning =
      this.config.visionPlanning && (parsed.assetContent?.length ?? 0) > 0
        ? this.config.visionPlanning
        : null;
    if (visionPlanning) {
      return this.requestPlan(
        {
          system: `${createPlanningRequestMessages(parsed).system} ${VISION_PLANNING_SYSTEM_ADDENDUM}`,
          user: createPlanningRequestContentParts(parsed),
        },
        visionPlanning,
      );
    }
    return this.requestPlan(createPlanningRequestMessages(parsed));
  }

  async generateLegacyPlan(input: LayoutModelRequest) {
    return this.requestPlan(createLayoutPlanMessages(input));
  }

  private async requestPlan(
    messages: {
      system: string;
      user: string | PlanningContentPart[];
    },
    visionPlanning?: VisionPlanningModelConfig | null,
  ) {
    const responseFormat =
      this.config.responseFormat === "json_schema"
        ? {
            type: "json_schema" as const,
            json_schema: {
              name: "ai_layout_plan",
              strict: true,
              schema: AI_LAYOUT_PLAN_JSON_SCHEMA,
            },
          }
        : this.config.responseFormat === "json_object"
          ? { type: "json_object" as const }
          : undefined;

    const client = visionPlanning
      ? (this.visionClient ?? this.client)
      : this.client;
    try {
      const completion = await client.chat.completions.create({
        model: visionPlanning?.model ?? this.config.model,
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
        response_format: responseFormat,
      });
      const message = completion.choices[0]?.message;
      if (!message?.content) {
        throw new LayoutProviderError(
          "invalid_response",
          message?.refusal || "Layout model returned an empty response",
        );
      }

      const parsed = extractJsonValue(message.content);
      return aiLayoutPlanResponseSchema.parse(parsed);
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof ZodError) {
        throw new LayoutProviderError(
          "invalid_response",
          "Layout model returned invalid plan JSON",
        );
      }
      throw classifyProviderError(error);
    }
  }
}

export function extractJsonValue(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced ?? trimmed;
  const objectStart = source.indexOf("{");
  const arrayStart = source.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) {
    throw new SyntaxError("No JSON value found");
  }

  const start = Math.min(...starts);
  const open = source[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (character === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }

  throw new SyntaxError("Incomplete JSON value");
}
