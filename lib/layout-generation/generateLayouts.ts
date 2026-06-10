import { createAiFallbackResponse } from "./adapters.ts";
import { generateFromTemplate } from "./generateFromTemplate.ts";
import { generateMockLayouts } from "./generateMockLayouts.ts";
import { generateLayoutRequestSchema } from "./schema.ts";
import type {
  GenerateLayoutRequest,
  GenerateLayoutResponse,
} from "@/types/generateLayout";

export function generateLayouts(
  input: GenerateLayoutRequest,
): GenerateLayoutResponse {
  const request = generateLayoutRequestSchema.parse(input);

  if (request.intent.mode === "template") {
    return {
      ...generateFromTemplate(request),
      source: "template",
    };
  }

  if (request.intent.mode === "mock-ai") {
    return {
      ...generateMockLayouts(request),
      source: "mock-ai",
    };
  }

  return createAiFallbackResponse(request);
}
