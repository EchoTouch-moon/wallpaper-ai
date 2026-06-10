import type { LayoutCandidate } from "@/types/layout";

export interface LayoutScore {
  total: number;
  colorHarmony: number;
  composition: number;
  safeArea: number;
  imageQuality: number;
}

function clamp(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

export function scoreLayout(candidate: LayoutCandidate): LayoutScore {
  const colorHarmony = candidate.harmonyScore;
  const itemCount = candidate.layout.items.length;
  const composition = clamp(itemCount >= 3 ? 0.84 : 0.6);
  const safeArea = candidate.layout.safeAreas.length > 0 ? 0.82 : 0.7;
  const imageQuality = candidate.usedFallback ? 0.68 : 0.86;
  const total = clamp(
    colorHarmony * 0.35 +
      composition * 0.3 +
      safeArea * 0.15 +
      imageQuality * 0.2,
  );

  return {
    total,
    colorHarmony,
    composition,
    safeArea,
    imageQuality,
  };
}
