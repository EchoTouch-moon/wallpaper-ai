import { validateCandidates } from "./validateCandidates.ts";
import type { GenerateLayoutRequest } from "@/types/generateLayout";
import type { LayoutCandidate } from "@/types/layout";

export function repairLayoutCandidates(
  candidates: LayoutCandidate[],
  request: GenerateLayoutRequest,
) {
  return validateCandidates(candidates, request, "ai");
}
