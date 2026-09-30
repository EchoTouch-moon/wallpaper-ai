import { z } from "zod";

import { compositionBriefSchema } from "./compositionBrief.ts";

export const createCompositionSessionRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    brief: compositionBriefSchema,
    assetIds: z.array(z.string().uuid()).min(2).max(6),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = new Set<string>();
    request.assetIds.forEach((assetId, index) => {
      if (ids.has(assetId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate asset id: ${assetId}`,
          path: ["assetIds", index],
        });
      }
      ids.add(assetId);
    });
  });

export const refineCompositionSessionRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    candidateId: z.string().min(1),
    instruction: z.string().trim().min(1).max(800),
    locked: z
      .object({
        target: z.boolean().default(true),
        heroAsset: z.boolean().default(false),
        safeAreas: z.boolean().default(true),
      })
      .strict()
      .default({
        target: true,
        heroAsset: false,
        safeAreas: true,
      }),
  })
  .strict();

export const undoCompositionRefinementRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    candidateId: z.string().min(1),
  })
  .strict();

export type CreateCompositionSessionRequest = z.infer<
  typeof createCompositionSessionRequestSchema
>;
export type RefineCompositionSessionRequest = z.infer<
  typeof refineCompositionSessionRequestSchema
>;
export type UndoCompositionRefinementRequest = z.infer<
  typeof undoCompositionRefinementRequestSchema
>;
