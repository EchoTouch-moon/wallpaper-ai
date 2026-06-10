import { validateLayout } from "../layout/validateLayout.ts";
import { WALLPAPER_TEMPLATE_IDS } from "../layout/templates.ts";
import type { LayoutCandidate } from "@/types/layout";
import type {
  GenerateLayoutRequest,
  GenerateLayoutSource,
  RejectedLayoutCandidate,
} from "@/types/generateLayout";

export function validateCandidates(
  candidates: LayoutCandidate[],
  request: GenerateLayoutRequest,
  source: Exclude<GenerateLayoutSource, "fallback">,
) {
  const assetIds = request.assets.map((asset) => asset.assetId);
  const accepted: LayoutCandidate[] = [];
  const rejected: RejectedLayoutCandidate[] = [];

  candidates.forEach((candidate) => {
    const result = validateLayout(candidate.layout, {
      assetIds,
      templateIds: WALLPAPER_TEMPLATE_IDS,
    });

    if (result.success) {
      accepted.push(candidate);
      return;
    }

    rejected.push({
      candidateId: candidate.id,
      source,
      reason: result.error.message,
      validationErrors: result.error.message.split("; "),
    });
  });

  return { candidates: accepted, rejected };
}
