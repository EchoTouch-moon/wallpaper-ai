import { selectTemplateTypes } from "./selectTemplate.ts";
import type { LayoutCandidate } from "@/types/layout";
import type { GenerateLayoutRequest } from "@/types/generateLayout";

export interface LayoutScore {
  total: number;
  colorHarmony: number;
  composition: number;
  safeArea: number;
  imageQuality: number;
  templateFit: number;
  reasons: string[];
}

function clamp(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function scoreComposition(candidate: LayoutCandidate) {
  const templateId = candidate.layout.template?.id ?? "";
  const intent = candidate.layout.guidance.intent;

  if (
    (intent === "single-hero" || intent === "hero-with-support") &&
    (templateId.includes("editorial") ||
      candidate.layout.template?.type === "layered-moodboard")
  ) {
    return 0.92;
  }

  if (intent === "balanced-collage" && templateId.includes("equal")) {
    return 0.9;
  }

  if (intent === "story-strip" && templateId.includes("cinematic")) {
    return 0.94;
  }

  return candidate.layout.items.length >= 3 ? 0.82 : 0.6;
}

function scoreTemplateFit(
  candidate: LayoutCandidate,
  request: GenerateLayoutRequest | undefined,
) {
  if (!request) {
    return 0.8;
  }

  const type = candidate.layout.template?.type;
  const preferredTypes = selectTemplateTypes(request);
  const index = type ? preferredTypes.indexOf(type) : -1;

  if (index === 0) {
    return 1;
  }

  if (index > 0) {
    return Math.max(0.58, 0.9 - index * 0.1);
  }

  return 0.55;
}

function scoreImageQuality(candidate: LayoutCandidate, request?: GenerateLayoutRequest) {
  if (!request) {
    return candidate.usedFallback ? 0.68 : 0.86;
  }

  const analysisById = new Map(
    request.assets.map((analysis) => [analysis.assetId, analysis]),
  );
  const averageResolution =
    candidate.layout.items.reduce((total, item) => {
      return total + (analysisById.get(item.assetId)?.resolutionScore ?? 0.5);
    }, 0) / Math.max(candidate.layout.items.length, 1);

  return clamp(averageResolution * (candidate.usedFallback ? 0.86 : 1));
}

function scoreReasons(candidate: LayoutCandidate, request?: GenerateLayoutRequest) {
  const reasons: string[] = [];
  const type = candidate.layout.template?.type;
  const primaryType = request ? selectTemplateTypes(request)[0] : undefined;

  if (request && type === primaryType) {
    reasons.push(`Matched ${type} to the strongest analyzed image signals.`);
  }

  if (request && type === "triptych" && primaryType === "triptych") {
    reasons.push("Color harmony is strong across the selected assets.");
  }

  if (candidate.harmonyScore >= 0.82) {
    reasons.push("Color harmony is strong across the selected assets.");
  }

  if (candidate.layout.guidance.intent === "hero-with-support") {
    reasons.push("Hero/support composition keeps one image visually dominant.");
  }

  if (candidate.layout.guidance.intent === "story-strip") {
    reasons.push("Story-strip composition fits cinematic or sequential images.");
  }

  if (candidate.layout.safeAreas.length > 0) {
    reasons.push("Safe areas are reserved for wallpaper UI overlays.");
  }

  if (candidate.usedFallback) {
    reasons.push("Some slots reused fallback-compatible assets.");
  }

  return reasons;
}

export function scoreLayout(
  candidate: LayoutCandidate,
  request?: GenerateLayoutRequest,
): LayoutScore {
  const colorHarmony = candidate.harmonyScore;
  const composition = scoreComposition(candidate);
  const safeArea = candidate.layout.safeAreas.length > 0 ? 0.82 : 0.7;
  const imageQuality = scoreImageQuality(candidate, request);
  const templateFit = scoreTemplateFit(candidate, request);
  const total = clamp(
    colorHarmony * 0.28 +
      composition * 0.24 +
      safeArea * 0.15 +
      imageQuality * 0.18 +
      templateFit * 0.15,
  );

  return {
    total,
    colorHarmony,
    composition,
    safeArea,
    imageQuality,
    templateFit,
    reasons: scoreReasons(candidate, request),
  };
}
