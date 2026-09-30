import { z } from "zod";

import {
  imageAssetAnalysisSchema,
  layoutCandidateSchema,
  wallpaperLayoutSchema,
} from "../layout/layoutSchema.ts";
import { compositionBriefSchema } from "./compositionBrief.ts";

export const compositionGenerationRequestSchema = z
  .object({
    brief: compositionBriefSchema,
    assets: z.array(imageAssetAnalysisSchema).min(2).max(6),
    candidateCount: z.literal(3).default(3),
  })
  .strict()
  .superRefine((request, context) => {
    const assetIds = new Set<string>();
    request.assets.forEach((asset, index) => {
      if (assetIds.has(asset.assetId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate analyzed asset id: ${asset.assetId}`,
          path: ["assets", index, "assetId"],
        });
      }
      assetIds.add(asset.assetId);
    });

    const heroAssetId = request.brief.intent.heroAssetId;
    if (heroAssetId && !assetIds.has(heroAssetId)) {
      context.addIssue({
        code: "custom",
        message: "The selected hero asset is not part of this composition",
        path: ["brief", "intent", "heroAssetId"],
      });
    }
  });

export const compositionGenerationResponseSchema = z
  .object({
    candidates: z.array(layoutCandidateSchema).length(3),
    source: z.enum(["ai", "recipe-fallback"]),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

export const compositionRefineRequestSchema = z
  .object({
    brief: compositionBriefSchema,
    assets: z.array(imageAssetAnalysisSchema).min(2).max(6),
    currentLayout: wallpaperLayoutSchema,
    instruction: z.string().trim().min(1).max(800),
    locked: z
      .object({
        target: z.boolean().default(true),
        heroAsset: z.boolean().default(false),
        safeAreas: z.boolean().default(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.currentLayout.template?.source !== "generated" ||
      !request.currentLayout.template.recipe
    ) {
      context.addIssue({
        code: "custom",
        message: "Refinement requires a generated template recipe",
        path: ["currentLayout", "template"],
      });
    }

    const assetIds = new Set(request.assets.map((asset) => asset.assetId));
    request.currentLayout.items.forEach((item, index) => {
      if (!assetIds.has(item.assetId)) {
        context.addIssue({
          code: "custom",
          message: `Current layout references unknown asset ${item.assetId}`,
          path: ["currentLayout", "items", index, "assetId"],
        });
      }
    });
  });

export type CompositionGenerationRequest = z.infer<
  typeof compositionGenerationRequestSchema
>;
export type CompositionGenerationResponse = z.infer<
  typeof compositionGenerationResponseSchema
>;
export type CompositionRefineRequest = z.infer<
  typeof compositionRefineRequestSchema
>;
