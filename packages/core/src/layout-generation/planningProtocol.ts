import { z } from "zod";

import {
  imageAssetAnalysisSchema,
  wallpaperLayoutSchema,
} from "../layout/layoutSchema.ts";
import { compositionBriefSchema } from "./compositionBrief.ts";
import type { ImageAssetAnalysis, WallpaperLayout } from "../types/layout.ts";
import type { CompositionBrief } from "./compositionBrief.ts";

/**
 * Planning protocol v2 (see plan/multimodal-planning-protocol-design.md §2.1).
 *
 * The orchestration contract consumes a native CompositionBrief instead of the
 * lossy GenerateLayoutRequest translation. The output side stays unchanged:
 * `aiPlanSchema` constraints, per-candidate repair, and deterministic
 * compilation all keep working exactly as before.
 */

/**
 * Inline image content reference for multimodal planning. The schema is part
 * of the v2 contract now, while the pure-text stage (VISION_PLANNING_ENABLED
 * off) simply never populates it; providers ignore it until the vision stage
 * wires it into multimodal message assembly.
 */
export const assetContentReferenceSchema = z
  .object({
    assetId: z.string().min(1),
    dataUrl: z
      .string()
      .regex(
        /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]*$/,
        "Asset content must be an inline base64 image data URL",
      ),
  })
  .strict();

export const planningRequestV2Schema = z
  .object({
    version: z.literal("2.0"),
    operation: z.enum(["generate", "refine"]),
    brief: compositionBriefSchema,
    assets: z.array(imageAssetAnalysisSchema).min(2).max(6),
    refineInstruction: z.string().trim().min(1).max(800).optional(),
    previousCandidates: z
      .array(wallpaperLayoutSchema)
      .min(1)
      .max(3)
      .optional(),
    assetContent: z.array(assetContentReferenceSchema).max(6).optional(),
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

    if (request.operation === "generate") {
      if (request.refineInstruction !== undefined) {
        context.addIssue({
          code: "custom",
          message: "refineInstruction is only valid for refine operations",
          path: ["refineInstruction"],
        });
      }
      if (request.previousCandidates !== undefined) {
        context.addIssue({
          code: "custom",
          message: "previousCandidates are only valid for refine operations",
          path: ["previousCandidates"],
        });
      }
    } else {
      if (request.refineInstruction === undefined) {
        context.addIssue({
          code: "custom",
          message: "Refine operations require a refineInstruction",
          path: ["refineInstruction"],
        });
      }
      if (request.previousCandidates === undefined) {
        context.addIssue({
          code: "custom",
          message:
            "Refine operations require at least one previous candidate layout",
          path: ["previousCandidates"],
        });
      }
      request.previousCandidates?.forEach((layout, index) => {
        layout.items.forEach((item, itemIndex) => {
          if (!assetIds.has(item.assetId)) {
            context.addIssue({
              code: "custom",
              message: `Previous candidate references unknown asset ${item.assetId}`,
              path: [
                "previousCandidates",
                index,
                "items",
                itemIndex,
                "assetId",
              ],
            });
          }
        });
      });
    }

    if (request.assetContent) {
      const contentAssetIds = new Set<string>();
      request.assetContent.forEach((content, index) => {
        if (!assetIds.has(content.assetId)) {
          context.addIssue({
            code: "custom",
            message: `Content reference points at unknown asset ${content.assetId}`,
            path: ["assetContent", index, "assetId"],
          });
        }
        if (contentAssetIds.has(content.assetId)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate content reference for asset ${content.assetId}`,
            path: ["assetContent", index, "assetId"],
          });
        }
        contentAssetIds.add(content.assetId);
      });
    }
  });

export type AssetContentReference = z.infer<
  typeof assetContentReferenceSchema
>;
export type PlanningRequest = z.infer<typeof planningRequestV2Schema>;

export function buildGeneratePlanningRequest(
  brief: CompositionBrief,
  assets: ImageAssetAnalysis[],
  assetContent?: AssetContentReference[],
): PlanningRequest {
  return planningRequestV2Schema.parse({
    version: "2.0",
    operation: "generate",
    brief,
    assets,
    ...(assetContent && assetContent.length > 0 ? { assetContent } : {}),
  });
}

export function buildRefinePlanningRequest(
  brief: CompositionBrief,
  assets: ImageAssetAnalysis[],
  refineInstruction: string,
  previousCandidates: WallpaperLayout[],
  assetContent?: AssetContentReference[],
): PlanningRequest {
  return planningRequestV2Schema.parse({
    version: "2.0",
    operation: "refine",
    brief,
    assets,
    refineInstruction,
    previousCandidates,
    ...(assetContent && assetContent.length > 0 ? { assetContent } : {}),
  });
}
