import { calculateCoverCrop, planTemplateCandidate } from "../layout/planTemplate.ts";
import { compileTemplateRecipe } from "../layout/compileTemplateRecipe.ts";
import {
  DEFAULT_TEMPLATE_RECIPES,
  templateRecipeSchema,
} from "../layout/templateRecipe.ts";
import { wallpaperLayoutSchema } from "../layout/layoutSchema.ts";
import { validateLayout } from "../layout/validateLayout.ts";
import {
  compositionGenerationRequestSchema,
  compositionGenerationResponseSchema,
} from "./compositionContracts.ts";

import { planningRatio, type CompositionBrief } from "./compositionBrief.ts";
import type { CompositionGenerationRequest } from "./compositionContracts.ts";
import type { TemplateRecipe } from "../layout/templateRecipe.ts";
import type {
  ImageAssetAnalysis,
  LayoutCandidate,
  WallpaperLayout,
} from "../types/layout.ts";

interface CompositionCandidatePlan {
  id: string;
  label: string;
  reason: string;
  harmonyScore: number;
  assignments: Array<{
    slotId: string;
    assetId: string;
    crop: {
      x: number;
      y: number;
      width: number;
      height: number;
      focalPoint: { x: number; y: number } | null;
    } | null;
  }>;
}

const PROFILE_COPY = {
  safe: {
    label: "Safe Structure",
    reason:
      "Ordered hierarchy, conservative crops, and protected working space.",
  },
  editorial: {
    label: "Editorial Rhythm",
    reason:
      "Asymmetric visual rhythm with a clear hero and intentional whitespace.",
  },
  dynamic: {
    label: "Dynamic Depth",
    reason:
      "Controlled overlap and scale contrast create a deeper spatial composition.",
  },
} as const;

function safeAreasForBrief(
  brief: CompositionBrief,
): WallpaperLayout["safeAreas"] {
  const { width, height } = brief.target;
  return brief.constraints.safeAreas.map((type, index) => {
    switch (type) {
      case "desktop-icons-left":
        return {
          id: `brief_safe_${index}`,
          type,
          x: 0,
          y: Math.round(height * 0.05),
          width: Math.round(width * 0.18),
          height: Math.round(height * 0.82),
        };
      case "desktop-icons-right":
        return {
          id: `brief_safe_${index}`,
          type,
          x: Math.round(width * 0.82),
          y: Math.round(height * 0.05),
          width: Math.round(width * 0.18),
          height: Math.round(height * 0.82),
        };
      case "desktop-dock":
        return {
          id: `brief_safe_${index}`,
          type,
          x: Math.round(width * 0.22),
          y: Math.round(height * 0.9),
          width: Math.round(width * 0.56),
          height: Math.round(height * 0.1),
        };
      case "mobile-clock":
        return {
          id: `brief_safe_${index}`,
          type,
          x: Math.round(width * 0.17),
          y: Math.round(height * 0.035),
          width: Math.round(width * 0.66),
          height: Math.round(height * 0.17),
        };
      case "mobile-widget-center":
        return {
          id: `brief_safe_${index}`,
          type,
          x: Math.round(width * 0.12),
          y: Math.round(height * 0.25),
          width: Math.round(width * 0.76),
          height: Math.round(height * 0.18),
        };
      case "subject-protection":
        return {
          id: `brief_safe_${index}`,
          type,
          x: Math.round(width * 0.35),
          y: Math.round(height * 0.25),
          width: Math.round(width * 0.3),
          height: Math.round(height * 0.5),
        };
    }
  });
}

function recipeForBrief(
  source: TemplateRecipe,
  brief: CompositionBrief,
  assetCount: number,
) {
  const avoidsLeftIcons = brief.constraints.safeAreas.includes(
    "desktop-icons-left",
  );
  const avoidsRightIcons = brief.constraints.safeAreas.includes(
    "desktop-icons-right",
  );
  // Mobile mapping (experiment findings 3/4): a clock strip at the top means
  // the hero belongs at the bottom of the screen, below the clock/widget
  // bands; a center widget band additionally raises the margin floor so the
  // content area starts at the band's top edge.
  const avoidsClock = brief.constraints.safeAreas.includes("mobile-clock");
  const hasCenterWidget = brief.constraints.safeAreas.includes(
    "mobile-widget-center",
  );
  const lockScreen = brief.target.usage === "lock-screen";
  const heroPosition = avoidsClock
    ? "bottom"
    : source.profile === "safe" && avoidsLeftIcons
      ? "right"
      : source.profile === "safe" && avoidsRightIcons
        ? "left"
        : lockScreen && source.profile === "safe"
          ? "center"
          : brief.intent.visualFlow === "right-to-left"
      ? "right"
      : brief.intent.visualFlow === "top-to-bottom"
        ? "top"
        : source.heroPosition;
  const densityAdjustments = {
    minimal: { margin: 0.02, gap: 0.008, heroShare: 0.04 },
    balanced: { margin: 0, gap: 0, heroShare: 0 },
    dense: { margin: -0.008, gap: -0.004, heroShare: -0.03 },
  } as const;
  const adjustment = densityAdjustments[brief.intent.density];
  const marginFloor = hasCenterWidget ? 0.25 : 0;

  return templateRecipeSchema.parse({
    ...source,
    family:
      lockScreen && source.profile === "safe"
        ? "balanced-mosaic"
        : source.family,
    heroPosition,
    heroShare: Math.min(0.76, Math.max(0.32, source.heroShare + adjustment.heroShare)),
    supportCount: assetCount - 1,
    margin: Math.min(0.3, Math.max(marginFloor, source.margin + adjustment.margin)),
    gap: Math.min(0.06, Math.max(0, source.gap + adjustment.gap)),
    safeAreaPolicy:
      brief.constraints.safeAreas.length > 0 ? "avoid" : "soft-avoid",
  });
}

function applyExplicitHero(
  layout: WallpaperLayout,
  heroAssetId: string | undefined,
  analyses: ImageAssetAnalysis[],
) {
  if (!heroAssetId) {
    return layout;
  }
  const heroIndex = layout.items.findIndex((item) => item.role === "hero");
  const selectedIndex = layout.items.findIndex(
    (item) => item.assetId === heroAssetId,
  );
  if (heroIndex < 0 || selectedIndex < 0 || heroIndex === selectedIndex) {
    return layout;
  }

  const items = layout.items.map((item) => ({ ...item }));
  const previousHeroAssetId = items[heroIndex].assetId;
  items[heroIndex].assetId = heroAssetId;
  items[selectedIndex].assetId = previousHeroAssetId;
  [heroIndex, selectedIndex].forEach((index) => {
    const analysis = analyses.find(
      (candidate) => candidate.assetId === items[index].assetId,
    );
    if (analysis) {
      items[index].crop = calculateCoverCrop(
        analysis,
        items[index].width,
        items[index].height,
      );
    }
  });

  return {
    ...layout,
    items,
  };
}

function applyPlannedAssignments(
  layout: WallpaperLayout,
  plan: CompositionCandidatePlan | undefined,
  analyses: ImageAssetAnalysis[],
) {
  if (!plan) {
    return layout;
  }
  const analysisById = new Map(
    analyses.map((analysis) => [analysis.assetId, analysis]),
  );
  const assignmentBySlot = new Map(
    plan.assignments.map((assignment) => [assignment.slotId, assignment]),
  );
  const items = layout.items.map((item) => {
    const assignment = assignmentBySlot.get(item.slotId ?? "");
    if (!assignment) {
      throw new Error(`Missing model assignment for slot ${item.slotId}`);
    }
    const analysis = analysisById.get(assignment.assetId);
    if (!analysis) {
      throw new Error(`Unknown model asset ${assignment.assetId}`);
    }
    return {
      ...item,
      assetId: assignment.assetId,
      crop: assignment.crop
        ? {
            ...assignment.crop,
            focalPoint: assignment.crop.focalPoint ?? undefined,
          }
        : calculateCoverCrop(analysis, item.width, item.height),
    };
  });

  return { ...layout, items };
}

export function createCompositionCandidateFromRecipe(
  request: CompositionGenerationRequest,
  recipe: TemplateRecipe,
  index: number,
  plan?: CompositionCandidatePlan,
): LayoutCandidate {
  const { brief, assets } = request;
  const ratioId = planningRatio(brief);
  const template = compileTemplateRecipe({
    recipe,
    ratioId: brief.target.ratioId,
    width: brief.target.width,
    height: brief.target.height,
    assetCount: assets.length,
  });
  const planned = planTemplateCandidate({
    analyses: assets,
    canvasSize: {
      width: brief.target.width,
      height: brief.target.height,
    },
    ratioId,
    template,
    templateIndex: index,
    intent:
      brief.intent.hierarchy === "balanced"
        ? "balanced-collage"
        : brief.intent.hierarchy === "single-hero"
          ? "single-hero"
          : "hero-with-support",
    templateSource: "generated",
    templateRecipe: recipe,
  });
  const withAssignments = applyPlannedAssignments(
    planned.layout,
    plan,
    assets,
  );
  const withHero = applyExplicitHero(
    withAssignments,
    brief.intent.heroAssetId,
    assets,
  );
  const layout = wallpaperLayoutSchema.parse({
    ...withHero,
    canvas: {
      ...withHero.canvas,
      ratio: brief.target.ratioId,
      usage:
        brief.target.usage === "mobile" ||
        brief.target.usage === "lock-screen"
          ? "mobile"
          : brief.target.usage === "ultrawide"
            ? "ultrawide"
            : brief.target.ratioId === "custom"
              ? "custom"
              : "desktop",
    },
    safeAreas: safeAreasForBrief(brief),
    guidance: {
      ...withHero.guidance,
      focalAssetId:
        brief.intent.heroAssetId ?? withHero.guidance.focalAssetId,
      visualFlow: brief.intent.visualFlow,
      preserveFaces: brief.constraints.preserveFaces,
      preserveNegativeSpace: brief.intent.density !== "dense",
    },
    notes: [
      ...withHero.notes,
      brief.intent.prompt
        ? `Composition intent: ${brief.intent.prompt}`
        : "Automatic composition with no user prompt.",
    ],
  });
  const validated = validateLayout(layout, {
    assetIds: assets.map((asset) => asset.assetId),
  });
  if (!validated.success) {
    throw validated.error;
  }
  const copy = PROFILE_COPY[recipe.profile];

  return {
    ...planned,
    id: plan?.id ?? `composition_${recipe.profile}`,
    label: plan?.label ?? copy.label,
    reason: plan?.reason ?? copy.reason,
    harmonyScore: plan?.harmonyScore ?? planned.harmonyScore,
    usedFallback: !plan,
    layout: validated.data,
  };
}

export function generateCompositionCandidates(input: unknown) {
  const request = compositionGenerationRequestSchema.parse(input);
  const candidates = DEFAULT_TEMPLATE_RECIPES.map((source, index) =>
    createCompositionCandidateFromRecipe(
      request,
      recipeForBrief(source, request.brief, request.assets.length),
      index,
    ),
  );

  return compositionGenerationResponseSchema.parse({
    candidates,
    source: "recipe-fallback",
    warnings: [],
  });
}
