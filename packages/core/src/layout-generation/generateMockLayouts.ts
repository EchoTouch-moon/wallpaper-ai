import { generateTemplateCandidates } from "../layout/planTemplate.ts";
import { selectTemplates, selectTemplateTypes } from "./selectTemplate.ts";
import { scoreLayout } from "./scoreLayout.ts";
import { validateCandidates } from "./validateCandidates.ts";
import type { LayoutCandidate, TemplateType } from "../types/layout";
import type { GenerateLayoutRequest } from "../types/generateLayout";

function candidateType(candidate: LayoutCandidate) {
  return candidate.layout.template?.type;
}

function selectDiverseCandidates(
  candidates: LayoutCandidate[],
  count: number,
  preferredTypes: TemplateType[],
  request: GenerateLayoutRequest,
) {
  const selected: LayoutCandidate[] = [];
  const usedTypes = new Set<string>();
  const preferredCandidates = candidates.sort((left, right) => {
    const leftType = candidateType(left);
    const rightType = candidateType(right);
    const typeDelta =
      preferredTypes.indexOf(leftType as TemplateType) -
      preferredTypes.indexOf(rightType as TemplateType);
    return (
      typeDelta ||
      scoreLayout(right, request).total - scoreLayout(left, request).total
    );
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

function explainCandidate(
  candidate: LayoutCandidate,
  request: GenerateLayoutRequest,
): LayoutCandidate {
  const score = scoreLayout(candidate, request);
  const reasons = score.reasons.slice(0, 3);
  const scoreSummary = `score ${Math.round(score.total * 100)} / color ${Math.round(
    score.colorHarmony * 100,
  )} / fit ${Math.round(score.templateFit * 100)}`;
  const reason =
    reasons.length > 0
      ? `${candidate.label}: ${reasons.join(" ")}`
      : candidate.reason;

  return {
    ...candidate,
    reason,
    layout: {
      ...candidate.layout,
      notes: [
        ...candidate.layout.notes,
        `Mock AI strategy: ${scoreSummary}.`,
        ...reasons,
      ],
    },
  };
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
    request,
  ).map((candidate) => explainCandidate(candidate, request));

  return validateCandidates(selected, request, "mock-ai");
}
