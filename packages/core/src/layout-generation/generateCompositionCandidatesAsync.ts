import { selectDiverseLayoutCandidates } from "./candidateDiversity.ts";
import {
  compositionRefineRequestSchema,
  compositionGenerationRequestSchema,
  compositionGenerationResponseSchema,
} from "./compositionContracts.ts";
import {
  createCompositionCandidateFromRecipe,
  createCompositionCandidateFromTemplate,
  generateCompositionCandidates,
} from "./generateCompositionCandidates.ts";
import { getTemplate } from "../layout/templates.ts";
import { refineTemplateRecipe } from "./refineTemplateRecipe.ts";
import {
  loadLayoutModelConfig,
  loadVisionPlanningConfig,
  type VisionPlanningModelConfig,
} from "./llmConfig.ts";
import {
  LayoutProviderError,
  OpenAICompatibleLayoutProvider,
} from "./openAiCompatibleProvider.ts";
import {
  buildGeneratePlanningRequest,
  buildRefinePlanningRequest,
  type PlanningRequest,
} from "./planningProtocol.ts";
import type { AiLayoutPlanResponse } from "./aiPlanSchema.ts";

import type { LayoutModelProvider } from "./provider.ts";
import type { WallpaperLayout } from "../types/layout.ts";

interface CompositionGenerationDependencies {
  provider?: LayoutModelProvider;
  environment?: Record<string, string | undefined>;
}

/**
 * Degradation chain tier 1 → tier 2 (plan/multimodal-planning-protocol-design.md
 * §2.4): when the multimodal call (gate on + assetContent present) fails, retry
 * once with the text-only planning request and report the degradation through
 * the existing warnings mechanism. The degradation is recorded on the caller's
 * `planningWarnings` array BEFORE the retry, so it stays observable even when
 * the text-only retry fails into the deterministic fallback tier.
 *
 * Tier 1.5 (leftover issue ③, intermittent invalid plan JSON): an
 * `invalid_response` failure is a malformed payload, not a dead endpoint — the
 * vision model intermittently emits non-contract JSON that a second identical
 * call frequently fixes. Before degrading to text-only, the multimodal request
 * is retried once AS-IS; the retry outcome is recorded in warnings either way
 * (a silent retry here would make intermittent contract misses unobservable).
 */
async function generatePlanWithTextFallback(
  provider: LayoutModelProvider,
  planning: PlanningRequest,
  buildTextOnlyRequest: () => PlanningRequest,
  visionPlanning: VisionPlanningModelConfig | null,
  planningWarnings: string[],
): Promise<AiLayoutPlanResponse> {
  if (!(planning.assetContent?.length ?? 0) || !visionPlanning) {
    return provider.generatePlan(planning);
  }
  try {
    return await provider.generatePlan(planning);
  } catch (error) {
    if (
      error instanceof LayoutProviderError &&
      error.code === "invalid_response"
    ) {
      try {
        const retriedPlan = await provider.generatePlan(planning);
        planningWarnings.push(
          "Vision planning returned invalid plan JSON; one identical retry recovered the multimodal plan.",
        );
        return retriedPlan;
      } catch (retryError) {
        planningWarnings.push(
          `Vision planning retry failed; falling back to text-only planning. (${
            retryError instanceof Error ? retryError.message : "unknown error"
          })`,
        );
        return provider.generatePlan(buildTextOnlyRequest());
      }
    }
    planningWarnings.push(
      `Vision planning failed; fell back to text-only planning. (${
        error instanceof Error ? error.message : "unknown error"
      })`,
    );
    return provider.generatePlan(buildTextOnlyRequest());
  }
}

export async function generateCompositionCandidatesAsync(
  input: unknown,
  dependencies: CompositionGenerationDependencies = {},
) {
  const request = compositionGenerationRequestSchema.parse(input);
  const fallback = generateCompositionCandidates(request);
  const planningWarnings: string[] = [];

  try {
    const provider =
      dependencies.provider ??
      new OpenAICompatibleLayoutProvider(
        loadLayoutModelConfig(dependencies.environment),
      );
    // Multimodal tier is only attempted when the gate resolves to a vision
    // configuration AND the request carries asset content; otherwise this is
    // the existing text-only planning path.
    const visionPlanning =
      (request.assetContent?.length ?? 0) > 0
        ? loadVisionPlanningConfig(dependencies.environment)
        : null;
    const plan = await generatePlanWithTextFallback(
      provider,
      buildGeneratePlanningRequest(
        request.brief,
        request.assets,
        request.assetContent,
      ),
      () => buildGeneratePlanningRequest(request.brief, request.assets),
      visionPlanning,
      planningWarnings,
    );
    // Discarded model candidates stay observable: a silent drop here made the
    // multimodal planner's intermittent contract misses (omitted background
    // assignment, unmaterializable recipe) indistinguishable from a clean
    // deterministic set (experiment v4: 4/4 scenarios at aiCount 0 with a
    // single fallback warning).
    const discardedWarnings: string[] = [];
    const modelCandidates = plan.candidates.flatMap((candidate, index) => {
      const candidateName = candidate.id ?? `candidate-${index + 1}`;
      try {
        // Registered candidates (templateId set, recipe null) are a legal
        // planning-protocol v2 shape; materialize them through the template
        // path instead of dropping them.
        if (candidate.templateId) {
          return [
            createCompositionCandidateFromTemplate(
              request,
              getTemplate(candidate.templateId),
              index,
              candidate,
            ),
          ];
        }
        if (!candidate.recipe) {
          discardedWarnings.push(
            `Model candidate ${candidateName} returned neither templateId nor recipe and was skipped.`,
          );
          return [];
        }
        return [
          createCompositionCandidateFromRecipe(
            request,
            candidate.recipe,
            index,
            candidate,
          ),
        ];
      } catch (error) {
        discardedWarnings.push(
          `Model candidate ${candidateName} could not be materialized: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [];
      }
    });
    const selection = selectDiverseLayoutCandidates(
      modelCandidates,
      fallback.candidates,
      3,
    );
    if (selection.candidates.length !== 3) {
      return compositionGenerationResponseSchema.parse({
        ...fallback,
        warnings: [
          ...planningWarnings,
          ...discardedWarnings,
          ...fallback.warnings,
        ],
      });
    }
    const fallbackCount = selection.candidates.filter(
      (candidate) => candidate.usedFallback,
    ).length;
    return compositionGenerationResponseSchema.parse({
      candidates: selection.candidates,
      source: modelCandidates.length > 0 ? "ai" : "recipe-fallback",
      warnings: [
        ...planningWarnings,
        ...discardedWarnings,
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
        ...planningWarnings,
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

  const planningWarnings: string[] = [];
  try {
    const provider =
      dependencies.provider ??
      new OpenAICompatibleLayoutProvider(
        loadLayoutModelConfig(dependencies.environment),
      );
    // Same multimodal → text-only degradation chain as generation (§2.4).
    const visionPlanning =
      (request.assetContent?.length ?? 0) > 0
        ? loadVisionPlanningConfig(dependencies.environment)
        : null;
    const plan = await generatePlanWithTextFallback(
      provider,
      buildRefinePlanningRequest(
        request.brief,
        request.assets,
        request.instruction,
        [request.currentLayout],
        request.assetContent,
      ),
      () =>
        buildRefinePlanningRequest(
          request.brief,
          request.assets,
          request.instruction,
          [request.currentLayout],
        ),
      visionPlanning,
      planningWarnings,
    );
    const modelPlan = plan.candidates.find((candidate) => candidate.recipe);
    if (!modelPlan?.recipe) {
      return {
        candidate: fallbackCandidate,
        source: "recipe-fallback" as const,
        warnings: [...planningWarnings, "The model returned no refinable recipe."],
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
      warnings: planningWarnings,
    };
  } catch (error) {
    return {
      candidate: fallbackCandidate,
      source: "recipe-fallback" as const,
      warnings: [
        ...planningWarnings,
        error instanceof Error
          ? `AI refinement unavailable: ${error.message}`
          : "AI refinement unavailable; deterministic refinement was used.",
      ],
    };
  }
}
