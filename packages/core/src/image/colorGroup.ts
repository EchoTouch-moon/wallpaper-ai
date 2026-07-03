import { colorDistance, hexToHsl } from "./colorAnalysis.ts";
import type { ImageAssetAnalysis } from "../types/layout";

export interface ColorGroup {
  id: string;
  themeColor: string;
  assets: string[];
  harmonyScore: number;
}

export interface TriptychSelection {
  assetIds: string[];
  harmonyScore: number;
  usedFallback: boolean;
  reason: string;
}

const GROUP_THRESHOLD = 0.22;

export function groupAssetsByColor(
  analyses: ImageAssetAnalysis[],
  threshold = GROUP_THRESHOLD,
): ColorGroup[] {
  const groups: Array<{
    id: string;
    themeColor: string;
    assets: string[];
    distances: number[];
  }> = [];

  [...analyses]
    .sort((left, right) => right.resolutionScore - left.resolutionScore)
    .forEach((analysis) => {
      const color = hexToHsl(analysis.averageColor);
      let bestGroup: (typeof groups)[number] | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;

      groups.forEach((group) => {
        const distance = colorDistance(color, hexToHsl(group.themeColor));
        if (distance <= threshold && distance < bestDistance) {
          bestGroup = group;
          bestDistance = distance;
        }
      });

      if (bestGroup) {
        bestGroup.assets.push(analysis.assetId);
        bestGroup.distances.push(bestDistance);
      } else {
        groups.push({
          id: `color_group_${groups.length + 1}`,
          themeColor: analysis.averageColor,
          assets: [analysis.assetId],
          distances: [0],
        });
      }
    });

  return groups
    .map((group) => ({
      id: group.id,
      themeColor: group.themeColor,
      assets: group.assets,
      harmonyScore:
        1 -
        group.distances.reduce((total, distance) => total + distance, 0) /
          Math.max(group.distances.length, 1),
    }))
    .sort(
      (left, right) =>
        right.assets.length - left.assets.length ||
        right.harmonyScore - left.harmonyScore,
    );
}

export function selectTriptychAssets(
  analyses: ImageAssetAnalysis[],
): TriptychSelection {
  if (analyses.length < 3) {
    throw new Error("At least three analyzed images are required");
  }

  const groups = groupAssetsByColor(analyses);
  const primaryGroup = groups[0];
  const analysisById = new Map(analyses.map((analysis) => [analysis.assetId, analysis]));
  const selected = [...primaryGroup.assets]
    .sort(
      (left, right) =>
        (analysisById.get(right)?.resolutionScore ?? 0) -
        (analysisById.get(left)?.resolutionScore ?? 0),
    )
    .slice(0, 3);
  const usedFallback = selected.length < 3;

  if (usedFallback) {
    const theme = hexToHsl(primaryGroup.themeColor);
    const nearest = analyses
      .filter((analysis) => !selected.includes(analysis.assetId))
      .sort((left, right) => {
        const distance =
          colorDistance(hexToHsl(left.averageColor), theme) -
          colorDistance(hexToHsl(right.averageColor), theme);
        return distance || right.resolutionScore - left.resolutionScore;
      });
    selected.push(...nearest.slice(0, 3 - selected.length).map((item) => item.assetId));
  }

  const distances = selected.map((assetId) =>
    colorDistance(
      hexToHsl(analysisById.get(assetId)?.averageColor ?? primaryGroup.themeColor),
      hexToHsl(primaryGroup.themeColor),
    ),
  );
  const harmonyScore =
    1 -
    distances.reduce((total, distance) => total + distance, 0) /
      distances.length;

  return {
    assetIds: selected,
    harmonyScore: Math.max(0, Math.min(1, harmonyScore)),
    usedFallback,
    reason: usedFallback
      ? "The strongest color group had fewer than three photos, so the nearest compatible image was added."
      : "Three high-resolution photos from the strongest color group were selected.",
  };
}
