import { aiLayoutPlanResponseSchema } from "./aiPlanSchema.ts";
import { calculateCoverCrop, planTemplateCandidate } from "../layout/planTemplate.ts";
import { getTemplate } from "../layout/templates.ts";
import { validateLayout } from "../layout/validateLayout.ts";
import type { AiLayoutPlanResponse } from "./aiPlanSchema.ts";
import type { GenerateLayoutRequest } from "@/types/generateLayout";
import type { LayoutCandidate } from "@/types/layout";

export class AiLayoutPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiLayoutPlanError";
  }
}

function materializeCandidate(
  plan: AiLayoutPlanResponse["candidates"][number],
  request: GenerateLayoutRequest,
  index: number,
): LayoutCandidate {
  const template = getTemplate(plan.templateId);
  if (!template.supportedRatios.includes(request.canvas.ratioId)) {
    throw new AiLayoutPlanError(
      `Template ${template.id} does not support ${request.canvas.ratioId}`,
    );
  }

  const analysisById = new Map(
    request.assets.map((analysis) => [analysis.assetId, analysis]),
  );
  const assignmentBySlot = new Map(
    plan.assignments.map((assignment) => [assignment.slotId, assignment]),
  );
  const templateSlotIds = new Set(template.slots.map((slot) => slot.id));

  plan.assignments.forEach((assignment) => {
    if (!templateSlotIds.has(assignment.slotId)) {
      throw new AiLayoutPlanError(
        `Unknown slot ${assignment.slotId} for template ${template.id}`,
      );
    }
    if (!analysisById.has(assignment.assetId)) {
      throw new AiLayoutPlanError(`Unknown asset ${assignment.assetId}`);
    }
  });

  const missingSlot = template.slots.find(
    (slot) => !assignmentBySlot.has(slot.id),
  );
  if (missingSlot) {
    throw new AiLayoutPlanError(
      `Missing assignment for template slot ${missingSlot.id}`,
    );
  }

  const baseCandidate = planTemplateCandidate({
    analyses: request.assets,
    canvasSize: request.canvas,
    ratioId: request.canvas.ratioId,
    template,
    templateIndex: index,
    intent: request.intent.compositionIntent,
  });

  const items = baseCandidate.layout.items.map((item) => {
    const assignment = assignmentBySlot.get(item.slotId ?? "");
    if (!assignment) {
      throw new AiLayoutPlanError(`Missing assignment for item ${item.id}`);
    }
    const analysis = analysisById.get(assignment.assetId);
    if (!analysis) {
      throw new AiLayoutPlanError(`Unknown asset ${assignment.assetId}`);
    }

    const plannedCrop = assignment.crop
      ? {
          ...assignment.crop,
          focalPoint: assignment.crop.focalPoint ?? undefined,
        }
      : null;

    return {
      ...item,
      assetId: assignment.assetId,
      crop:
        plannedCrop ??
        calculateCoverCrop(analysis, item.width, item.height),
    };
  });

  const layout = {
    ...baseCandidate.layout,
    canvas: {
      ...baseCandidate.layout.canvas,
      backgroundColor:
        plan.backgroundColor ?? baseCandidate.layout.canvas.backgroundColor,
    },
    items,
    guidance: {
      ...baseCandidate.layout.guidance,
      focalAssetId:
        items.find((item) => item.role === "hero")?.assetId ??
        items[0]?.assetId,
    },
    notes: [
      ...baseCandidate.layout.notes,
      `Model plan ${plan.id} was materialized against registered template ${template.id}.`,
    ],
  };

  const validated = validateLayout(layout, {
    assetIds: analysisById.keys(),
    templateIds: [template.id],
  });
  if (!validated.success) {
    throw new AiLayoutPlanError(validated.error.message);
  }

  return {
    id: plan.id,
    label: plan.label,
    reason: plan.reason,
    harmonyScore: plan.harmonyScore,
    usedFallback: false,
    layout: validated.data,
  };
}

export function materializeAiLayoutPlan(
  input: unknown,
  request: GenerateLayoutRequest,
) {
  const plan = aiLayoutPlanResponseSchema.parse(input);
  return plan.candidates.map((candidate, index) =>
    materializeCandidate(candidate, request, index),
  );
}
