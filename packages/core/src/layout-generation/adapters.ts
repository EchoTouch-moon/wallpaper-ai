import { generateFromTemplate } from "./generateFromTemplate.ts";
import { generateMockLayouts } from "./generateMockLayouts.ts";
import { generateRecipeLayouts } from "./generateRecipeLayouts.ts";
import type {
  GenerateLayoutRequest,
  GenerateLayoutResponse,
} from "../types/generateLayout.ts";
import type { LayoutCandidate } from "../types/layout.ts";

export interface LayoutModelAdapter {
  generateLayouts(request: GenerateLayoutRequest): Promise<LayoutCandidate[]>;
}

export class TemplateLayoutAdapter implements LayoutModelAdapter {
  async generateLayouts(request: GenerateLayoutRequest) {
    return generateFromTemplate(request).candidates;
  }
}

export class MockAiLayoutAdapter implements LayoutModelAdapter {
  async generateLayouts(request: GenerateLayoutRequest) {
    return generateMockLayouts(request).candidates;
  }
}

export function createAiFallbackResponse(
  request: GenerateLayoutRequest,
  reason = "AI mode is not connected yet.",
): GenerateLayoutResponse {
  const result = generateRecipeLayouts(request);
  return {
    ...result,
    source: "fallback",
    warnings: [
      `${reason} Returned deterministic recipe candidates instead.`,
    ],
  };
}
