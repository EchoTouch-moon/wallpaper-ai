import { selectDiverseLayoutCandidates } from "./candidateDiversity.ts";
import {
  compositionRefineRequestSchema,
  compositionGenerationRequestSchema,
  compositionGenerationResponseSchema,
} from "./compositionContracts.ts";
import {
  createCompositionCandidateFromRecipe,
  generateCompositionCandidates,
} from "./generateCompositionCandidates.ts";
import { refineTemplateRecipe } from "./refineTemplateRecipe.ts";
import { loadLayoutModelConfig } from "./llmConfig.ts";
import { OpenAICompatibleLayoutProvider } from "./openAiCompatibleProvider.ts";
import {
  buildGeneratePlanningRequest,
  buildRefinePlanningRequest,
} from "./planningProtocol.ts";

import type { LayoutModelProvider } from "./provider.ts";
import type { WallpaperLayout } from "../types/layout.ts";

interface CompositionGenerationDependencies {
  provider?: LayoutModelProvider;
  environment?: Record<string, string | undefined>;
}

export async function generateCompositionCandidatesAsync(
  input: unknown,
  dependencies: CompositionGenerationDependencies = {},
) {
  const request = compositionGenerationRequestSchema.parse(input);
  const fallback = generateCompositionCandidates(request);

  try {
    const provider =
      dependencies.provider ??
      new OpenAICompatibleLayoutProvider(
        loadLayoutModelConfig(dependencies.environment),
      );
    const plan = await provider.generatePlan(
      buildGeneratePlanningRequest(request.brief, request.assets),
    );
    const modelCandidates = plan.candidates.flatMap((candidate, index) => {
      if (!candidate.recipe) {
        return [];
      }
      try {
        return [
          createCompositionCandidateFromRecipe(
            request,
            candidate.recipe,
            index,
            candidate,
          ),
        ];
      } catch {
        return [];
      }
    });
    const selection = selectDiverseLayoutCandidates(
      modelCandidates,
      fallback.candidates,
      3,
    );
    if (selection.candidates.length !== 3) {
      return fallback;
    }
    const fallbackCount = selection.candidates.filter(
      (candidate) => candidate.usedFallback,
    ).length;
    return compositionGenerationResponseSchema.parse({
      candidates: selection.candidates,
      source: modelCandidates.length > 0 ? "ai" : "recipe-fallback",
      warnings: [
        ...(fallbackCount > 0
          ? [
              `${fallbackCount} deterministic candidate${
                fallbackCount === 1 ? "" : "s"
              } completed the model set.`,
            ]
          : []),
        ...(selection.skippedCandidateIds.length > 0
          ? ["Near-duplicate model candidates were replaced."]
          : []),
      ],
    });
  } catch (error) {
    return compositionGenerationResponseSchema.parse({
      ...fallback,
      warnings: [
        error instanceof Error
          ? `AI planner unavailable: ${error.message}`
          : "AI planner unavailable; deterministic recipes were used.",
      ],
    });
  }
}

export async function refineCompositionCandidateAsync(
  input: unknown,
  dependencies: CompositionGenerationDependencies = {},
) {
  const request = compositionRefineRequestSchema.parse(input);
  const currentRecipe = request.currentLayout.template?.recipe;
  if (!currentRecipe) {
    throw new Error("The current composition has no recipe to refine");
  }
  const fallbackRecipe = refineTemplateRecipe(
    currentRecipe,
    request.instruction,
    request.assets.length,
  );
  const generationRequest = {
    brief: request.brief,
    assets: request.assets,
    candidateCount: 3 as const,
  };
  const fallbackCandidate = createCompositionCandidateFromRecipe(
    generationRequest,
    fallbackRecipe,
    0,
  );

  try {
    const provider =
      dependencies.provider ??
      new OpenAICompatibleLayoutProvider(
        loadLayoutModelConfig(dependencies.environment),
      );
    const plan = await provider.generatePlan(
      buildRefinePlanningRequest(
        request.brief,
        request.assets,
        request.instruction,
        [request.currentLayout],
      ),
    );
    const modelPlan = plan.candidates.find((candidate) => candidate.recipe);
    if (!modelPlan?.recipe) {
      return {
        candidate: fallbackCandidate,
        source: "recipe-fallback" as const,
        warnings: ["The model returned no refinable recipe."],
      };
    }
    return {
      candidate: createCompositionCandidateFromRecipe(
        generationRequest,
        modelPlan.recipe,
        0,
        modelPlan,
      ),
      source: "ai" as const,
      warnings: [] as string[],
    };
  } catch (error) {
    return {
      candidate: fallbackCandidate,
      source: "recipe-fallback" as const,
      warnings: [
        error instanceof Error
          ? `AI refinement unavailable: ${error.message}`
          : "AI refinement unavailable; deterministic refinement was used.",
      ],
    };
  }
}
