import { generateTemplateCandidates } from "../layout/planTemplate.ts";
import { selectTemplates, selectTemplateTypes } from "./selectTemplate.ts";
import { scoreLayout } from "./scoreLayout.ts";
import { validateCandidates } from "./validateCandidates.ts";
import type { LayoutCandidate, TemplateType } from "@/types/layout";
import type { GenerateLayoutRequest } from "@/types/generateLayout";

function candidateType(candidate: LayoutCandidate) {
  return candidate.layout.template?.type;
}

function selectDiverseCandidates(
  candidates: LayoutCandidate[],
  count: number,
  preferredTypes: TemplateType[],
) {
  const selected: LayoutCandidate[] = [];
  const usedTypes = new Set<string>();
  const preferredCandidates = candidates.sort((left, right) => {
    const leftType = candidateType(left);
    const rightType = candidateType(right);
    const typeDelta =
      preferredTypes.indexOf(leftType as TemplateType) -
      preferredTypes.indexOf(rightType as TemplateType);
    return typeDelta || scoreLayout(right).total - scoreLayout(left).total;
  });

  for (const candidate of preferredCandidates) {
    const type = candidateType(candidate);
    if (!type || usedTypes.has(type)) {
      continue;
    }
    selected.push(candidate);
    usedTypes.add(type);
    if (selected.length >= count) {
      return selected;
    }
  }

  for (const candidate of preferredCandidates) {
    if (selected.some((item) => item.id === candidate.id)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= count) {
      return selected;
    }
  }

  return selected;
}

export function generateMockLayouts(request: GenerateLayoutRequest) {
  const candidateCount = request.options?.candidateCount ?? request.intent.count ?? 3;
  const preferredTypes = selectTemplateTypes(request);
  const templates = selectTemplates(request);
  const allCandidates = generateTemplateCandidates(
    request.assets,
    {
      width: request.canvas.width,
      height: request.canvas.height,
    },
    request.canvas.ratioId,
    templates,
    request.intent.compositionIntent,
  );
  const selected = selectDiverseCandidates(
    allCandidates,
    candidateCount,
    preferredTypes,
  );

  return validateCandidates(selected, request, "mock-ai");
}
