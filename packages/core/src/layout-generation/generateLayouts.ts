import { createAiFallbackResponse } from "./adapters.ts";
import {
  LayoutGenerationError,
  ensureGenerated,
  isFallbackAllowed,
} from "./generationFallback.ts";
import { generateFromTemplate } from "./generateFromTemplate.ts";
import { generateMockLayouts } from "./generateMockLayouts.ts";
import { loadLayoutModelConfig } from "./llmConfig.ts";
import { materializeAiLayoutPlan } from "./materializeAiLayoutPlan.ts";
import { OpenAICompatibleLayoutProvider } from "./openAiCompatibleProvider.ts";
import { generateLayoutRequestSchema } from "./schema.ts";
import type { LayoutModelProvider } from "./provider.ts";
import type {
  GenerateLayoutRequest,
  GenerateLayoutResponse,
} from "../types/generateLayout";

export { LayoutGenerationError } from "./generationFallback.ts";

interface GenerateLayoutsDependencies {
  provider?: LayoutModelProvider;
}

export function generateLayouts(
  input: GenerateLayoutRequest,
): GenerateLayoutResponse {
  const request = generateLayoutRequestSchema.parse(input);

  if (request.intent.mode === "template") {
    return ensureGenerated(
      {
        ...generateFromTemplate(request),
        source: "template",
      },
      request,
      "Template mode produced no valid layouts. Returned mock-ai layout candidates instead.",
    );
  }

  if (request.intent.mode === "mock-ai") {
    return ensureGenerated(
      {
        ...generateMockLayouts(request),
        source: "mock-ai",
      },
      request,
      "Mock AI mode produced no valid layouts. Returned fallback layout candidates instead.",
    );
  }

  if (!isFallbackAllowed(request)) {
    throw new LayoutGenerationError(
      "AI mode is not connected yet and fallback is disabled.",
    );
  }

  return createAiFallbackResponse(request);
}

export async function generateLayoutsAsync(
  input: GenerateLayoutRequest,
  dependencies: GenerateLayoutsDependencies = {},
): Promise<GenerateLayoutResponse> {
  const request = generateLayoutRequestSchema.parse(input);

  if (request.intent.mode !== "ai") {
    return generateLayouts(request);
  }

  try {
    const provider =
      dependencies.provider ??
      new OpenAICompatibleLayoutProvider(loadLayoutModelConfig());
    const plan = await provider.generatePlan({
      operation: request.operation,
      request,
    });
    const requestedCount =
      request.operation === "refine"
        ? 1
        : (request.options?.candidateCount ?? request.intent.count ?? 3);
    const candidates = materializeAiLayoutPlan(plan, request).slice(
      0,
      requestedCount,
    );

    return ensureGenerated(
      {
        candidates,
        rejected: [],
        source: "ai",
      },
      request,
      "The layout model produced no valid candidates. Returned mock-ai layout candidates instead.",
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Layout model request failed";
    if (!isFallbackAllowed(request)) {
      throw new LayoutGenerationError(message);
    }
    return createAiFallbackResponse(request, message);
  }
}
