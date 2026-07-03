import { ZodError } from "zod";

import { createFallbackResponse, LayoutGenerationError } from "./generationFallback.ts";
import {
  findUnsupportedPayloadFields,
  handleGenerateLayoutError,
} from "./handleGenerateLayoutRequest.ts";
import { startLangGraphSession } from "./langgraphOrchestrator.ts";
import { materializeAiLayoutPlan } from "./materializeAiLayoutPlan.ts";
import { generateLayoutRequestSchema } from "./schema.ts";
import type {
  GenerateLayoutHandlerResponse,
} from "./handleGenerateLayoutRequest.ts";

function invalidRequest(
  issues: { path: string; message: string }[],
): GenerateLayoutHandlerResponse {
  return {
    status: 400,
    body: {
      error: "Invalid generate-layout request",
      code: "invalid_request",
      issues,
    },
  };
}

export async function handleLangGraphGenerateLayoutRequest(
  body: unknown,
): Promise<GenerateLayoutHandlerResponse> {
  const unsupportedIssues = findUnsupportedPayloadFields(body);
  if (unsupportedIssues.length > 0) {
    return invalidRequest(unsupportedIssues);
  }

  try {
    const request = generateLayoutRequestSchema.parse(body);
    if (request.intent.mode !== "ai") {
      throw new LayoutGenerationError(
        "LangGraph orchestration only accepts AI layout requests.",
      );
    }
    const result = await startLangGraphSession(request);
    const candidates = materializeAiLayoutPlan(result.plan, request).slice(
      0,
      request.operation === "refine"
        ? 1
        : (request.options?.candidateCount ?? request.intent.count ?? 3),
    );
    if (candidates.length === 0) {
      throw new LayoutGenerationError(
        "LangGraph returned no valid layout candidates.",
      );
    }
    return {
      status: 200,
      body: {
        candidates,
        rejected: [],
        source: "ai",
        session: result.session,
      },
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return handleGenerateLayoutError(error);
    }
    if (error instanceof LayoutGenerationError) {
      return handleGenerateLayoutError(error);
    }
    try {
      const request = generateLayoutRequestSchema.parse(body);
      if (request.options?.allowFallback !== false) {
        return { status: 200, body: createFallbackResponse(request, String(error)) };
      }
    } catch (validationError) {
      return handleGenerateLayoutError(validationError);
    }
    return handleGenerateLayoutError(error);
  }
}
