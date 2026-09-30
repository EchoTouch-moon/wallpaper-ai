import { compileTemplateRecipe } from "../layout/compileTemplateRecipe.ts";
import {
  DEFAULT_TEMPLATE_RECIPES,
  type TemplateRecipe,
} from "../layout/templateRecipe.ts";
import { planTemplateCandidate } from "../layout/planTemplate.ts";
import { validateCandidates } from "./validateCandidates.ts";

import type { GenerateLayoutRequest } from "../types/generateLayout.ts";
import type { LayoutCandidate } from "../types/layout.ts";

const PROFILE_COPY = {
  safe: {
    label: "Safe Structure",
    reason:
      "A calm, ordered composition with conservative crops and generous usable space.",
  },
  editorial: {
    label: "Editorial Rhythm",
    reason:
      "A magazine-inspired composition with asymmetric hierarchy and intentional whitespace.",
  },
  dynamic: {
    label: "Dynamic Depth",
    reason:
      "A controlled layered composition with stronger scale contrast and spatial depth.",
  },
} as const;

function adaptRecipe(
  recipe: TemplateRecipe,
  request: GenerateLayoutRequest,
): TemplateRecipe {
  const supportCount = Math.min(5, Math.max(1, request.assets.length - 1));
  const portrait = request.canvas.height > request.canvas.width;

  return {
    ...recipe,
    supportCount,
    heroPosition:
      portrait && recipe.profile === "safe"
        ? "top"
        : recipe.heroPosition,
  };
}

export function generateRecipeLayouts(request: GenerateLayoutRequest) {
  const candidateCount = Math.min(
    3,
    request.options?.candidateCount ?? request.intent.count ?? 3,
  );
  const candidates = DEFAULT_TEMPLATE_RECIPES.slice(0, candidateCount).map(
    (defaultRecipe, index): LayoutCandidate => {
      const recipe = adaptRecipe(defaultRecipe, request);
      const template = compileTemplateRecipe({
        recipe,
        ratioId: request.canvas.ratioId,
        width: request.canvas.width,
        height: request.canvas.height,
        assetCount: request.assets.length,
      });
      const planned = planTemplateCandidate({
        analyses: request.assets,
        canvasSize: request.canvas,
        ratioId: request.canvas.ratioId,
        template,
        templateIndex: index,
        intent: request.intent.compositionIntent,
        templateSource: "generated",
        templateRecipe: recipe,
      });
      const copy = PROFILE_COPY[recipe.profile];

      return {
        ...planned,
        id: `candidate_${recipe.profile}`,
        label: copy.label,
        reason: copy.reason,
        usedFallback: true,
        layout: {
          ...planned.layout,
          notes: [
            ...planned.layout.notes,
            `Deterministic ${recipe.profile} fallback recipe.`,
          ],
        },
      };
    },
  );

  return validateCandidates(candidates, request, "mock-ai");
}
