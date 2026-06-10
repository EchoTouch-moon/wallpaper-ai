import { z } from "zod";
import {
  imageAssetAnalysisSchema,
  wallpaperLayoutSchema,
} from "../layout/layoutSchema.ts";

export const generateLayoutModeSchema = z.enum(["template", "mock-ai", "ai"]);

export const generateLayoutStyleSchema = z.enum([
  "same-tone-triptych",
  "layered-moodboard",
  "portrait-triptych",
  "irregular-collage",
  "auto",
]);

export const generateLayoutRequestSchema = z.object({
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    ratioId: z.enum(["16:9", "16:10", "21:9", "9:16", "9:19.5"]),
  }),
  intent: z.object({
    mode: generateLayoutModeSchema,
    style: generateLayoutStyleSchema,
    compositionIntent: z
      .enum(["single-hero", "hero-with-support", "balanced-collage", "story-strip"])
      .optional(),
    safeArea: z
      .enum(["none", "desktop-left", "mobile-top", "desktop-bottom"])
      .optional(),
    count: z.number().int().positive().max(8).optional(),
    userPrompt: z.string().max(1200).optional(),
  }),
  assets: z.array(imageAssetAnalysisSchema).min(3),
  currentLayout: wallpaperLayoutSchema.optional(),
  options: z
    .object({
      candidateCount: z.number().int().positive().max(8).optional(),
      allowFallback: z.boolean().optional(),
      strictValidation: z.boolean().optional(),
    })
    .optional(),
});
