import { generateTemplateCandidates } from "./planTemplate.ts";
import { validateLayout } from "./validateLayout.ts";
import { WALLPAPER_TEMPLATES, WALLPAPER_TEMPLATE_IDS } from "./templates.ts";
import type { CanvasSize } from "../types/canvas";
import type {
  CompositionIntent,
  ImageAssetAnalysis,
  LayoutCandidate,
  WallpaperLayout,
} from "../types/layout";
import type { WallpaperRatioId } from "../types/wallpaper";

export interface LayoutGenerationInput {
  analyses: ImageAssetAnalysis[];
  canvasSize: CanvasSize;
  ratioId: WallpaperRatioId;
  intent?: CompositionIntent;
  maxCandidates?: number;
}

export interface LayoutGenerationResult {
  candidates: LayoutCandidate[];
  rejected: Array<{
    candidateId: string;
    reason: string;
  }>;
}

function scoreCandidateForIntent(
  candidate: LayoutCandidate,
  intent: CompositionIntent | undefined,
) {
  const templateId = candidate.layout.template?.id ?? "";

  if (!intent) {
    return 0;
  }

  if (intent === "single-hero" || intent === "hero-with-support") {
    return templateId.includes("editorial") ? 2 : 0;
  }

  if (intent === "balanced-collage") {
    return templateId.includes("equal") ? 2 : 0;
  }

  if (intent === "story-strip") {
    return templateId.includes("cinematic") ? 2 : 0;
  }

  return 0;
}

function validateCandidateLayout(
  candidateId: string,
  layout: WallpaperLayout,
  assetIds: string[],
) {
  const result = validateLayout(layout, {
    assetIds,
    templateIds: WALLPAPER_TEMPLATE_IDS,
  });

  if (result.success) {
    return null;
  }

  return {
    candidateId,
    reason: result.error.message,
  };
}

function selectCandidateMix(
  candidates: LayoutCandidate[],
  maxCandidates: number,
) {
  const selected: LayoutCandidate[] = [];
  const selectedTypes = new Set<string>();

  for (const candidate of candidates) {
    const type = candidate.layout.template?.type;
    if (!type || selectedTypes.has(type)) {
      continue;
    }
    selected.push(candidate);
    selectedTypes.add(type);
    if (selected.length >= maxCandidates) {
      return selected;
    }
  }

  for (const candidate of candidates) {
    if (selected.some((item) => item.id === candidate.id)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= maxCandidates) {
      return selected;
    }
  }

  return selected;
}

export function generateLayoutCandidates({
  analyses,
  canvasSize,
  ratioId,
  intent,
  maxCandidates = 3,
}: LayoutGenerationInput): LayoutGenerationResult {
  if (analyses.length < 3) {
    throw new Error("At least three analyzed images are required");
  }

  const assetIds = analyses.map((analysis) => analysis.assetId);
  const seenAssetIds = new Set<string>();
  for (const assetId of assetIds) {
    if (seenAssetIds.has(assetId)) {
      throw new Error(`Duplicate analyzed asset id: ${assetId}`);
    }
    seenAssetIds.add(assetId);
  }

  const templates = WALLPAPER_TEMPLATES.filter((template) =>
    template.supportedRatios.includes(ratioId),
  );

  const sortedCandidates = generateTemplateCandidates(
    analyses,
    canvasSize,
    ratioId,
    templates,
    intent,
  )
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const scoreDelta =
        scoreCandidateForIntent(right.candidate, intent) -
        scoreCandidateForIntent(left.candidate, intent);
      return scoreDelta || left.index - right.index;
    })
    .map(({ candidate }) => candidate);
  const rawCandidates = selectCandidateMix(sortedCandidates, maxCandidates);

  const candidates: LayoutCandidate[] = [];
  const rejected: LayoutGenerationResult["rejected"] = [];

  rawCandidates.forEach((candidate) => {
    const rejection = validateCandidateLayout(
      candidate.id,
      candidate.layout,
      assetIds,
    );

    if (rejection) {
      rejected.push(rejection);
      return;
    }

    candidates.push(candidate);
  });

  return { candidates, rejected };
}
