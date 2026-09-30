import { z } from "zod";

export const templateRecipeFamilySchema = z.enum([
  "hero-grid",
  "balanced-mosaic",
  "triptych",
  "stacked-story",
  "layered-collage",
]);

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
  })
  .strict();

export type TemplateRecipeFamily = z.infer<
  typeof templateRecipeFamilySchema
>;
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
