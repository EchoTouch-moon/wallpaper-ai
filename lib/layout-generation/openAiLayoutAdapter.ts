import { createLayoutPrompt } from "./layoutPrompt.ts";
import { parseLayoutResponseText } from "./parseLayoutResponse.ts";
import { repairLayoutCandidates } from "./repairLayout.ts";
import { validateCandidates } from "./validateCandidates.ts";
import {
  LayoutGenerationError,
  createFallbackResponse,
  ensureGenerated,
  isFallbackAllowed,
} from "./generationFallback.ts";
import type {
  GenerateLayoutRequest,
  GenerateLayoutResponse,
} from "@/types/generateLayout";
import type { LayoutCandidate } from "@/types/layout";

export interface LayoutModelClient {
  generateText(prompt: string): Promise<string>;
}

export interface OpenAILayoutAdapterOptions {
  enabled?: boolean;
  modelClient?: LayoutModelClient;
}

export interface AiLayoutPipelineInput {
  request: GenerateLayoutRequest;
  modelOutputText: string;
}

function fallbackFromAiPipeline(
  request: GenerateLayoutRequest,
  warning: string,
) {
  if (!isFallbackAllowed(request)) {
    throw new LayoutGenerationError(warning);
  }

  return createFallbackResponse(request, warning);
}

export function runAiLayoutPipeline({
  request,
  modelOutputText,
}: AiLayoutPipelineInput): GenerateLayoutResponse {
  try {
    const parsedCandidates = parseLayoutResponseText(modelOutputText);
    const validated = validateCandidates(parsedCandidates, request, "ai");

    if (validated.candidates.length > 0 && validated.rejected.length === 0) {
      return ensureGenerated(
        {
          ...validated,
          source: "ai",
        },
        request,
        "AI layout validation produced no valid candidates. Returned mock-ai layout candidates instead.",
      );
    }

    const repaired = repairLayoutCandidates(parsedCandidates, request);
    const candidateById = new Map<string, LayoutCandidate>();

    [...validated.candidates, ...repaired.candidates].forEach((candidate) => {
      candidateById.set(candidate.id, candidate);
    });

    const candidates = [...candidateById.values()];
    return ensureGenerated(
      {
        candidates,
        rejected: repaired.rejected,
        source: "ai",
        warnings:
          candidates.length > 0
            ? ["AI layout candidates required a repair pass before validation."]
            : undefined,
      },
      request,
      "AI layout repair produced no valid candidates. Returned mock-ai layout candidates instead.",
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process AI layout output.";
    return fallbackFromAiPipeline(
      request,
      `AI layout output could not be parsed or validated. Returned mock-ai layout candidates instead. ${message}`,
    );
  }
}

export class OpenAILayoutAdapter {
  private readonly enabled: boolean;
  private readonly modelClient?: LayoutModelClient;

  constructor(options: OpenAILayoutAdapterOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.modelClient = options.modelClient;
  }

  async generateLayoutResponse(
    request: GenerateLayoutRequest,
  ): Promise<GenerateLayoutResponse> {
    if (!this.enabled || !this.modelClient) {
      return fallbackFromAiPipeline(
        request,
        "OpenAI layout adapter is disabled. Returned mock-ai layout candidates instead.",
      );
    }

    const prompt = createLayoutPrompt(request);
    try {
      const modelOutputText = await this.modelClient.generateText(prompt);
      return runAiLayoutPipeline({ request, modelOutputText });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "OpenAI layout adapter failed.";
      return fallbackFromAiPipeline(
        request,
        `OpenAI layout adapter failed. Returned mock-ai layout candidates instead. ${message}`,
      );
    }
  }

  async generateLayouts(request: GenerateLayoutRequest): Promise<LayoutCandidate[]> {
    const response = await this.generateLayoutResponse(request);
    return response.candidates;
  }
}
