import { createAiFallbackResponse } from "./adapters.ts";
import { generateFromTemplate } from "./generateFromTemplate.ts";
import { generateMockLayouts } from "./generateMockLayouts.ts";
import { generateLayoutRequestSchema } from "./schema.ts";
import type {
  GenerateLayoutRequest,
  GenerateLayoutResponse,
} from "@/types/generateLayout";

export class LayoutGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutGenerationError";
  }
}

function isFallbackAllowed(request: GenerateLayoutRequest) {
  return request.options?.allowFallback !== false;
}

function createFallbackResponse(
  request: GenerateLayoutRequest,
  warning: string,
): GenerateLayoutResponse {
  const result = generateMockLayouts({
    ...request,
    intent: {
      ...request.intent,
      mode: "mock-ai",
    },
  });

  if (result.candidates.length === 0) {
    throw new LayoutGenerationError("Fallback generation produced no valid layouts.");
  }

  return {
    ...result,
    source: "fallback",
    warnings: [warning],
  };
}

function ensureGenerated(
  response: GenerateLayoutResponse,
  request: GenerateLayoutRequest,
  fallbackWarning: string,
) {
  if (response.candidates.length > 0) {
    return response;
  }

  if (isFallbackAllowed(request)) {
    return createFallbackResponse(request, fallbackWarning);
  }

  throw new LayoutGenerationError("No valid layout candidates were generated.");
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
