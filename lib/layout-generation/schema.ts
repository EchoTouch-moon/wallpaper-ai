import { z } from "zod";
import {
  imageAssetAnalysisSchema,
  wallpaperLayoutSchema,
} from "../layout/layoutSchema.ts";
import { aiLayoutOperationSchema } from "./aiPlanSchema.ts";

export const generateLayoutModeSchema = z.enum(["template", "mock-ai", "ai"]);

export const generateLayoutStyleSchema = z.enum([
  "same-tone-triptych",
  "layered-moodboard",
  "portrait-triptych",
  "irregular-collage",
  "auto",
]);

export const generateLayoutRequestSchema = z
  .object({
    operation: aiLayoutOperationSchema.default("generate"),
    canvas: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        ratioId: z.enum(["16:9", "16:10", "21:9", "9:16", "9:19.5"]),
      })
      .strict(),
    intent: z
      .object({
        mode: generateLayoutModeSchema,
        style: generateLayoutStyleSchema,
        compositionIntent: z
          .enum([
            "single-hero",
            "hero-with-support",
            "balanced-collage",
            "story-strip",
          ])
          .optional(),
        safeArea: z
          .enum(["none", "desktop-left", "mobile-top", "desktop-bottom"])
          .optional(),
        count: z.number().int().positive().max(8).optional(),
        userPrompt: z.string().max(1200).optional(),
      })
      .strict(),
    assets: z.array(imageAssetAnalysisSchema).min(3),
    currentLayout: wallpaperLayoutSchema.optional(),
    options: z
      .object({
        candidateCount: z.number().int().positive().max(8).optional(),
        allowFallback: z.boolean().optional(),
        strictValidation: z.boolean().optional(),
      })
      .strict()
      .optional(),
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

    if (request.operation === "refine") {
      if (!request.currentLayout) {
        context.addIssue({
          code: "custom",
          message: "Refine requests require the current layout",
          path: ["currentLayout"],
        });
      }
      if (!request.intent.userPrompt?.trim()) {
        context.addIssue({
          code: "custom",
          message: "Refine requests require a user prompt",
          path: ["intent", "userPrompt"],
        });
      }
    }
  });
