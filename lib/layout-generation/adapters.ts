import { generateFromTemplate } from "./generateFromTemplate.ts";
import { generateMockLayouts } from "./generateMockLayouts.ts";
import type {
  GenerateLayoutRequest,
  GenerateLayoutResponse,
} from "@/types/generateLayout";
import type { LayoutCandidate } from "@/types/layout";

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
): GenerateLayoutResponse {
  const result = generateMockLayouts(request);
  return {
    ...result,
    source: "fallback",
    warnings: [
      "AI mode is not connected yet. Returned mock-ai layout candidates instead.",
    ],
  };
}
