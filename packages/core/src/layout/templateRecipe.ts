import { z } from "zod";

export const templateRecipeFamilySchema = z.enum([
  "hero-grid",
  "balanced-mosaic",
  "triptych",
  "stacked-story",
  "layered-collage",
]);

/**
 * Semantic control vocabulary (multimodal planning protocol v2, §2.2 — see
 * plan/multimodal-planning-protocol-design.md). These knobs are semantics
 * only: the model never emits absolute geometry, and the compiler
 * (`compileTemplateRecipe`) is the single place that maps them onto crop
 * boxes, slot scale tiers, and overlap offsets.
 *
 * Every field is optional. A recipe without them compiles byte-identically
 * to the previous behavior (guarded by the eval baseline).
 *
 * Defined locally (instead of reusing `normalizedPointSchema` from
 * layoutSchema.ts) because layoutSchema imports templateRecipeSchema —
 * importing back would create a cycle.
 */
const cropFocusPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const cropFocusSchema = z.union([
  z.enum(["subject", "saliency", "center"]),
  cropFocusPointSchema,
]);

export const cropZoomSchema = z.enum(["tight", "standard", "loose"]);

export const cropIntentSchema = z
  .object({
    focus: cropFocusSchema.optional(),
    zoom: cropZoomSchema.optional(),
  })
  .strict();

export const visualWeightSchema = z.enum([
  "dominant",
  "balanced",
  "subtle",
]);

export const layeringSchema = z.enum(["none", "slight", "strong"]);

/**
 * Per-slot intents, keyed by the stable generated slot ids the model is
 * told about (hero, support-1 onward, background for layered-collage).
 * Intents for slots a recipe does not actually produce are ignored.
 */
export const slotIntentSchema = z
  .object({
    cropIntent: cropIntentSchema.optional(),
    visualWeight: visualWeightSchema.optional(),
  })
  .strict();

export const templateRecipeSchema = z
  .object({
    version: z.literal("1.0"),
    profile: z.enum(["safe", "editorial", "dynamic"]),
    family: templateRecipeFamilySchema,
    heroPosition: z.enum([
      "left",
      "right",
      "top",
      "center",
      "background",
    ]),
    heroShare: z.number().min(0.32).max(0.76),
    supportCount: z.number().int().min(1).max(5),
    margin: z.number().min(0).max(0.12),
    gap: z.number().min(0).max(0.06),
    cornerRadius: z.number().min(0).max(0.08),
    rhythm: z.enum(["ordered", "asymmetric", "layered"]),
    boundary: z.enum([
      "edge-to-edge",
      "clean-gap",
      "hairline",
      "soft-shadow",
      "overlap",
      "feather",
      "paper-edge",
    ]),
    safeAreaPolicy: z.enum(["avoid", "soft-avoid"]),
    slotIntents: z
      .record(z.string().min(1), slotIntentSchema)
      .optional(),
    layering: layeringSchema.optional(),
  })
  .strict();

export type TemplateRecipeFamily = z.infer<
  typeof templateRecipeFamilySchema
>;
export type CropFocus = z.infer<typeof cropFocusSchema>;
export type CropIntent = z.infer<typeof cropIntentSchema>;
export type VisualWeight = z.infer<typeof visualWeightSchema>;
export type Layering = z.infer<typeof layeringSchema>;
export type SlotIntent = z.infer<typeof slotIntentSchema>;
export type TemplateRecipe = z.infer<typeof templateRecipeSchema>;

export const DEFAULT_TEMPLATE_RECIPES: readonly TemplateRecipe[] = [
  {
    version: "1.0",
    profile: "safe",
    family: "hero-grid",
    heroPosition: "left",
    heroShare: 0.56,
    supportCount: 5,
    margin: 0.02,
    gap: 0.012,
    cornerRadius: 0.018,
    rhythm: "ordered",
    boundary: "clean-gap",
    safeAreaPolicy: "avoid",
  },
  {
    version: "1.0",
    profile: "editorial",
    family: "balanced-mosaic",
    heroPosition: "center",
    heroShare: 0.48,
    supportCount: 5,
    margin: 0.018,
    gap: 0.009,
    cornerRadius: 0.022,
    rhythm: "asymmetric",
    boundary: "soft-shadow",
    safeAreaPolicy: "soft-avoid",
  },
  {
    version: "1.0",
    profile: "dynamic",
    family: "layered-collage",
    heroPosition: "center",
    heroShare: 0.62,
    supportCount: 5,
    margin: 0.025,
    gap: 0.008,
    cornerRadius: 0.026,
    rhythm: "layered",
    boundary: "overlap",
    safeAreaPolicy: "soft-avoid",
  },
] as const;
