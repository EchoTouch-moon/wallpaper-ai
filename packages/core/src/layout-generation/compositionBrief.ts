import { z } from "zod";

import { safeAreaTypeSchema } from "../layout/layoutSchema.ts";
import type { WallpaperRatioId } from "../types/wallpaper.ts";

// Nearest known ratio for planning heuristics when a brief targets custom
// dimensions; non-custom targets pass through unchanged.
export function planningRatio(brief: CompositionBrief): WallpaperRatioId {
  if (brief.target.ratioId !== "custom") {
    return brief.target.ratioId;
  }
  if (brief.target.height > brief.target.width) {
    return "9:16";
  }
  if (brief.target.width / brief.target.height > 2) {
    return "21:9";
  }
  return "16:9";
}

export const compositionTargetSchema = z
  .object({
    ratioId: z.enum([
      "16:9",
      "16:10",
      "21:9",
      "9:16",
      "9:19.5",
      "custom",
    ]),
    width: z.number().int().min(720).max(7680),
    height: z.number().int().min(720).max(7680),
    usage: z.enum([
      "desktop",
      "laptop",
      "ultrawide",
      "mobile",
      "lock-screen",
    ]),
  })
  .strict()
  .superRefine((target, context) => {
    const ratio = target.width / target.height;
    if (ratio < 0.4 || ratio > 3) {
      context.addIssue({
        code: "custom",
        message: "Target aspect ratio must remain between 0.4 and 3",
        path: ["width"],
      });
    }
    if (target.width * target.height > 33_000_000) {
      context.addIssue({
        code: "custom",
        message: "Target canvas must not exceed 33 megapixels",
        path: ["width"],
      });
    }
  });

export const compositionBriefSchema = z
  .object({
    version: z.literal("1.0"),
    target: compositionTargetSchema,
    intent: z
      .object({
        prompt: z.string().trim().max(1200),
        heroAssetId: z.string().min(1).optional(),
        hierarchy: z.enum(["single-hero", "hero-support", "balanced"]),
        density: z.enum(["minimal", "balanced", "dense"]),
        rhythm: z.enum(["ordered", "asymmetric", "layered"]),
        visualFlow: z.enum([
          "left-to-right",
          "right-to-left",
          "top-to-bottom",
          "center-out",
        ]),
        moodTags: z.array(z.string().trim().min(1).max(32)).max(8),
      })
      .strict(),
    constraints: z
      .object({
        safeAreas: z.array(safeAreaTypeSchema).max(6),
        preserveFaces: z.boolean(),
        preserveText: z.boolean(),
        cropTolerance: z.enum(["low", "medium", "high"]),
      })
      .strict(),
    /**
     * Optional style-library pin (packages/core/src/layout/styleLibrary.ts).
     * Both fields are optional so pre-style briefs parse byte-identically.
     *
     * - "locked"   — the style recipe compiles deterministically; no LLM
     *   planning, no brief-driven recipe adaptation.
     * - "anchored" — LLM planning runs with the style anchor injected into
     *   the planning prompt (default when styleId is set without a mode).
     */
    styleId: z.string().trim().min(1).max(64).optional(),
    styleMode: z.enum(["locked", "anchored"]).optional(),
  })
  .strict()
  .superRefine((brief, context) => {
    if (brief.styleMode && !brief.styleId) {
      context.addIssue({
        code: "custom",
        message: "styleMode requires a styleId from the style library",
        path: ["styleMode"],
      });
    }
  });

export type CompositionTarget = z.infer<typeof compositionTargetSchema>;
export type CompositionBrief = z.infer<typeof compositionBriefSchema>;

export function createDefaultCompositionBrief(
  target: CompositionTarget,
): CompositionBrief {
  const mobile =
    target.usage === "mobile" || target.usage === "lock-screen";
  return compositionBriefSchema.parse({
    version: "1.0",
    target,
    intent: {
      prompt: "",
      hierarchy: "hero-support",
      density: "balanced",
      rhythm: "ordered",
      visualFlow: mobile ? "top-to-bottom" : "left-to-right",
      moodTags: [],
    },
    constraints: {
      safeAreas:
        target.usage === "lock-screen"
          ? ["mobile-clock"]
          : mobile
            ? ["mobile-widget-center"]
            : ["desktop-icons-left", "desktop-dock"],
      preserveFaces: true,
      preserveText: true,
      cropTolerance: "medium",
    },
  });
}
