import { generateTemplateCandidates } from "../layout/planTemplate.ts";
import { selectTemplates } from "./selectTemplate.ts";
import { scoreLayout } from "./scoreLayout.ts";
import { validateCandidates } from "./validateCandidates.ts";
import type { GenerateLayoutRequest } from "../types/generateLayout";

export function generateFromTemplate(request: GenerateLayoutRequest) {
  const candidateCount = request.options?.candidateCount ?? request.intent.count ?? 3;
  const templates = selectTemplates(request).filter((template) => {
    if (request.intent.style === "auto") {
      return true;
    }
    return request.intent.style === "same-tone-triptych"
      ? template.type === "triptych"
      : request.intent.style === template.type;
  });
  const candidates = generateTemplateCandidates(
    request.assets,
    {
      width: request.canvas.width,
      height: request.canvas.height,
    },
    request.canvas.ratioId,
    templates,
    request.intent.compositionIntent,
  )
    .sort(
      (left, right) =>
        scoreLayout(right, request).total - scoreLayout(left, request).total,
    )
    .slice(0, candidateCount);

  return validateCandidates(candidates, request, "template");
}
