import { z } from "zod";

export const templateRecipeFamilySchema = z.enum([
  "hero-grid",
  "balanced-mosaic",
  "triptych",
  "stacked-story",
  "layered-collage",
  "diagonal-collage",
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

/**
 * Analysis-driven targets ("faces", "contour") place the crop window inside
 * the upgraded `calculateCoverCrop` entry (planTemplate.ts): "faces" is a
 * hard keep-the-face-union constraint, "contour" maximizes window↔subject
 * overlap. They fall back through the remaining signals when the analysis
 * lacks the data.
 */
export const cropFocusSchema = z.union([
  z.enum(["subject", "saliency", "center", "contour", "faces"]),
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
 * Per-slot raster treatment (how the assigned asset is placed into the slot):
 *
 * - "full"   — scale to fit, whole image visible, no cropping (contain);
 * - "crop"   — the existing cover crop (fill the slot, crop the overflow);
 * - "cutout" — remove the background, keep only the subject.
 *
 * Defined here (not in layoutSchema.ts) because layoutSchema imports this
 * module; layoutSchema reuses the enum for the layout item passthrough field
 * so the two stay in sync.
 */
export const slotTreatmentSchema = z.enum(["full", "crop", "cutout"]);

/**
 * Recipe-level parameters for the "diagonal-collage" family. All optional —
 * a diagonal recipe without them compiles with the reference-aligned
 * defaults below, and every mapping from parameter to geometry lives in the
 * deterministic compiler (`planDiagonalCollageSlots`), never in the model.
 *
 * - backgroundColor: solid canvas color behind the collage (reference olive
 *   #4A5D3A); absent = transparent canvas (no solid fill).
 * - axis: which canvas diagonal the composition runs along.
 *   "bl-tr" = bottom-left → top-right (the reference), "tl-br" = top-left →
 *   bottom-right.
 * - heroShare: each of the two hero slots' size as a fraction of the content
 *   rect (applied to both axes; portrait canvases get portrait heroes).
 * - supportShare: each support card's size, same unit.
 * - overlap: how much consecutive axis cards stack (叠压程度), 0 = touching
 *   chain, 0.6 = heavy stacking. Also drives the lateral stagger amplitude.
 *
 * The number of support cards along the axis is the recipe's top-level
 * `supportCount` (shared vocabulary with the other families).
 */
export const diagonalCollageParamsSchema = z
  .object({
    backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    axis: z.enum(["bl-tr", "tl-br"]).default("bl-tr"),
    heroShare: z.number().min(0.2).max(0.6).default(0.46),
    supportShare: z.number().min(0.1).max(0.4).default(0.24),
    overlap: z.number().min(0).max(0.6).default(0.3),
  })
  .strict();

/**
 * Per-slot intents, keyed by the stable generated slot ids the model is
 * told about (hero, support-1 onward, background for layered-collage).
 * Intents for slots a recipe does not actually produce are ignored.
 */
export const slotIntentSchema = z
  .object({
    cropIntent: cropIntentSchema.optional(),
    visualWeight: visualWeightSchema.optional(),
    treatment: slotTreatmentSchema.default("crop"),
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
      "bottom",
      "center",
      "background",
    ]),
    heroShare: z.number().min(0.32).max(0.76),
    supportCount: z.number().int().min(1).max(5),
    // Ceiling 0.3 (not 0.12): mobile briefs with a center widget band raise
    // the margin floor to 0.25 so the content area starts below the band.
    margin: z.number().min(0).max(0.3),
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
    diagonal: diagonalCollageParamsSchema.optional(),
  })
  .strict();

export type TemplateRecipeFamily = z.infer<
  typeof templateRecipeFamilySchema
>;
export type CropFocus = z.infer<typeof cropFocusSchema>;
export type CropZoom = z.infer<typeof cropZoomSchema>;
export type CropIntent = z.infer<typeof cropIntentSchema>;
export type VisualWeight = z.infer<typeof visualWeightSchema>;
export type Layering = z.infer<typeof layeringSchema>;
export type SlotTreatment = z.infer<typeof slotTreatmentSchema>;
export type DiagonalCollageParams = z.infer<
  typeof diagonalCollageParamsSchema
>;
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
