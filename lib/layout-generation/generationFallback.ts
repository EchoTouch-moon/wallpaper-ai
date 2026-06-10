import { generateMockLayouts } from "./generateMockLayouts.ts";
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

export function isFallbackAllowed(request: GenerateLayoutRequest) {
  return request.options?.allowFallback !== false;
}

export function createFallbackResponse(
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

export function ensureGenerated(
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
