import { z } from "zod";

import { normalizedBoxSchema, normalizedPointSchema } from "../layout/layoutSchema.ts";

export const aiLayoutOperationSchema = z.enum(["generate", "refine"]);

export const aiSlotAssignmentSchema = z
  .object({
    slotId: z.string().min(1),
    assetId: z.string().min(1),
    crop: normalizedBoxSchema
      .extend({
        focalPoint: normalizedPointSchema.nullable(),
      })
      .nullable(),
  })
  .strict();

export const aiLayoutPlanCandidateSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).max(80),
    reason: z.string().min(1).max(500),
    harmonyScore: z.number().min(0).max(1),
    templateId: z.string().min(1),
    assignments: z.array(aiSlotAssignmentSchema).min(1),
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable(),
  })
  .strict()
  .superRefine((candidate, context) => {
    const slotIds = new Set<string>();
    candidate.assignments.forEach((assignment, index) => {
      if (slotIds.has(assignment.slotId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate slot assignment: ${assignment.slotId}`,
          path: ["assignments", index, "slotId"],
        });
      }
      slotIds.add(assignment.slotId);
    });
  });

export const aiLayoutPlanResponseSchema = z
  .object({
    candidates: z.array(aiLayoutPlanCandidateSchema).min(1).max(8),
  })
  .strict();

export type AiLayoutOperation = z.infer<typeof aiLayoutOperationSchema>;
export type AiSlotAssignment = z.infer<typeof aiSlotAssignmentSchema>;
export type AiLayoutPlanCandidate = z.infer<
  typeof aiLayoutPlanCandidateSchema
>;
export type AiLayoutPlanResponse = z.infer<typeof aiLayoutPlanResponseSchema>;
