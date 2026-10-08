import { z } from "zod";

import {
  templateRecipeFamilySchema,
  templateRecipeSchema,
  type TemplateRecipe,
} from "./templateRecipe.ts";

/**
 * Code-state style library (plan/style-library-seeds.md, P2 of the style
 * reverse roadmap): the P1 reverse-engineered reference recipes, manually
 * curated into versioned TypeScript data so a composition brief can pin a
 * style by id (see `CompositionBrief.styleId` / `styleMode`).
 *
 * Every entry originates from `temp/style-reverse-run-data.json`
 * (2026-10-04 run, plan/style-reverse-p1.md §3). `styleNotes` keeps the VLM's
 * "what the protocol cannot express" text VERBATIM — those decorative-layer
 * gaps (text banners, stickers, textures) are the honest record of everything
 * the recipe alone will not reproduce.
 */
export interface StyleLibraryEntry {
  readonly id: string;
  readonly name: string;
  /** Provenance pointer: run-data file plus the seed reference image. */
  readonly sourceRef: string;
  readonly recipe: TemplateRecipe;
  readonly styleNotes: string;
  readonly tags: readonly string[];
}

const RUN_DATA = "temp/style-reverse-run-data.json";

const STYLE_SEEDS: readonly StyleLibraryEntry[] = [
  {
    id: "xhs-diagonal",
    name: "XHS Diagonal Collage",
    sourceRef: `${RUN_DATA}#seeds[xhs-diagonal-ref.jpg]`,
    tags: ["xhs", "diagonal-collage", "p1-acceptance", "magazine-flat"],
    styleNotes:
      "The layout features a strong diagonal axis from bottom-left to top-right with significant overlapping elements. It includes decorative text banners (标题, 装饰文字), ornamental shapes (装饰), and circular accent stickers (点缀) that are not captured by the standard slot system. The background has a solid olive-green tone, and the composition uses a mix of rectangular and non-rectangular decorative overlays with varying opacities and soft edges.",
    recipe: {
      version: "1.0",
      profile: "dynamic",
      family: "diagonal-collage",
      heroPosition: "left",
      heroShare: 0.45,
      supportCount: 4,
      margin: 0.05,
      gap: 0,
      cornerRadius: 0.02,
      rhythm: "asymmetric",
      boundary: "overlap",
      safeAreaPolicy: "soft-avoid",
      slotIntents: {
        hero: {
          cropIntent: { focus: "saliency", zoom: "standard" },
          visualWeight: "dominant",
          treatment: "crop",
        },
        "hero-2": {
          cropIntent: { focus: "saliency", zoom: "standard" },
          visualWeight: "dominant",
          treatment: "crop",
        },
        "support-1": {
          cropIntent: { focus: "center", zoom: "loose" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-2": {
          cropIntent: { focus: "center", zoom: "loose" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-3": {
          cropIntent: { focus: "center", zoom: "loose" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-4": {
          cropIntent: { focus: "center", zoom: "loose" },
          visualWeight: "subtle",
          treatment: "crop",
        },
      },
      layering: "strong",
      diagonal: {
        backgroundColor: "#5C6B4A",
        axis: "bl-tr",
        heroShare: 0.45,
        supportShare: 0.25,
        overlap: 0.35,
      },
    },
  },
  {
    id: "canva-portrait-scrapbook",
    name: "Canva Portrait Scrapbook",
    sourceRef: `${RUN_DATA}#seeds[canva-34c8dc8b0a16.jpg]`,
    tags: ["canva", "layered-collage", "scrapbook", "polaroid"],
    styleNotes:
      "The recipe captures the layered, scrapbook-style composition with a central hero image and two polaroid-style support photos, but cannot express the specific decorative text overlays (e.g., 'Only for you', Chinese typography, dates), the handwritten script background texture, the botanical line art illustrations, or the precise white border/polaroid frame styling and slight rotation angles of the support images.",
    recipe: {
      version: "1.0",
      profile: "editorial",
      family: "layered-collage",
      heroPosition: "center",
      heroShare: 0.55,
      supportCount: 2,
      margin: 0.08,
      gap: 0.04,
      cornerRadius: 0.02,
      rhythm: "layered",
      boundary: "paper-edge",
      safeAreaPolicy: "soft-avoid",
      slotIntents: {
        background: {
          cropIntent: { focus: "center", zoom: "loose" },
          visualWeight: "subtle",
          treatment: "full",
        },
        hero: {
          cropIntent: { focus: { x: 0.5, y: 0.4 }, zoom: "standard" },
          visualWeight: "dominant",
          treatment: "crop",
        },
        "support-1": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-2": {
          cropIntent: { focus: "saliency", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
      },
      layering: "strong",
    },
  },
  {
    id: "canva-browser-window",
    name: "Canva Browser Window Journal",
    sourceRef: `${RUN_DATA}#seeds[canva-50687fae91bd.jpg]`,
    tags: ["canva", "hero-grid", "ui-chrome", "journal"],
    styleNotes:
      "The layout mimics a digital desktop or social media interface with UI chrome (browser bars, window controls, close buttons) framing the images as 'windows'. It features heavy typographic overlays in mixed Chinese/English script, decorative starburst and sparkle graphics, soft gradient backgrounds, and drop shadows that give a floating card effect. The aesthetic is bright, airy, and journal-like with pastel blue tones.",
    recipe: {
      version: "1.0",
      profile: "editorial",
      family: "hero-grid",
      heroPosition: "left",
      heroShare: 0.48,
      supportCount: 4,
      margin: 0.06,
      gap: 0.03,
      cornerRadius: 0.02,
      rhythm: "asymmetric",
      boundary: "soft-shadow",
      safeAreaPolicy: "soft-avoid",
      slotIntents: {
        hero: {
          cropIntent: { focus: "saliency", zoom: "standard" },
          visualWeight: "dominant",
          treatment: "crop",
        },
        "support-1": {
          cropIntent: { focus: "center", zoom: "loose" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-2": {
          cropIntent: { focus: "center", zoom: "standard" },
          visualWeight: "dominant",
          treatment: "crop",
        },
        "support-3": {
          cropIntent: { focus: "center", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-4": {
          cropIntent: { focus: "center", zoom: "loose" },
          visualWeight: "subtle",
          treatment: "crop",
        },
      },
      layering: "slight",
    },
  },
  {
    id: "canva-kraft-polaroid",
    name: "Canva Kraft Polaroid Journal",
    sourceRef: `${RUN_DATA}#seeds[canva-92133cbf73dd.jpg]`,
    tags: ["canva", "hero-grid", "kraft-paper", "polaroid", "hand-journal"],
    styleNotes:
      "The layout features a textured kraft paper background with torn edges and handwritten script overlays. Photos are styled as Polaroid prints with thick white borders, slight rotations, and realistic drop shadows. Decorative elements include a binder clip on the hero image, washi tape strips, paper stickers (butterfly, ginkgo leaf, flower, camera), and text banners ('SUNDAY', 'THIS WEEK') in mixed fonts. Handwritten dates and Chinese captions are placed at the bottom of specific frames.",
    recipe: {
      version: "1.0",
      profile: "editorial",
      family: "hero-grid",
      heroPosition: "center",
      heroShare: 0.38,
      supportCount: 4,
      margin: 0.08,
      gap: 0.04,
      cornerRadius: 0.02,
      rhythm: "ordered",
      boundary: "soft-shadow",
      safeAreaPolicy: "avoid",
      slotIntents: {
        hero: {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "dominant",
          treatment: "crop",
        },
        "support-1": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-2": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-3": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-4": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
      },
      layering: "slight",
    },
  },
  {
    id: "canva-polka-dot-plog",
    name: "Canva Polka-dot Scrapbook Plog",
    sourceRef: `${RUN_DATA}#seeds[canva-fbf87736e32b.jpg]`,
    tags: ["canva", "layered-collage", "polka-dot", "plog"],
    styleNotes:
      "The layout is heavily decorated with a scrapbook aesthetic, featuring a polka-dot background pattern, lace doily borders, decorative tape (washi), paper bows, star-shaped frames, and handwritten text banners in both Chinese and English. The central visual element is a metallic lunchbox/tin container that acts as a physical frame for two of the support images, while other photos are overlaid with whimsical stickers like teddy bears and headphones.",
    recipe: {
      version: "1.0",
      profile: "dynamic",
      family: "layered-collage",
      heroPosition: "right",
      heroShare: 0.35,
      supportCount: 4,
      margin: 0.08,
      gap: 0.04,
      cornerRadius: 0.02,
      rhythm: "asymmetric",
      boundary: "overlap",
      safeAreaPolicy: "soft-avoid",
      slotIntents: {
        background: {
          cropIntent: { focus: "center", zoom: "loose" },
          visualWeight: "subtle",
          treatment: "full",
        },
        hero: {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "dominant",
          treatment: "crop",
        },
        "support-1": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-2": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-3": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
        "support-4": {
          cropIntent: { focus: "subject", zoom: "standard" },
          visualWeight: "balanced",
          treatment: "crop",
        },
      },
      layering: "strong",
    },
  },
];

/**
 * Library contents are parsed against the recipe protocol once at module
 * load: a hand-edited entry that drifts out of contract fails at import time
 * instead of at the first locked compilation. Entries and the list itself are
 * frozen — the library is code-state data, never mutated at runtime.
 */
const STYLE_LIBRARY: readonly StyleLibraryEntry[] = Object.freeze(
  STYLE_SEEDS.map((seed) =>
    Object.freeze({
      ...seed,
      tags: Object.freeze([...seed.tags]),
      recipe: templateRecipeSchema.parse(seed.recipe),
    }),
  ),
);

export function listStyles(): readonly StyleLibraryEntry[] {
  return STYLE_LIBRARY;
}

export function getStyle(id: string): StyleLibraryEntry | undefined {
  return STYLE_LIBRARY.find((style) => style.id === id);
}

/**
 * Style anchor for anchored (LLM-planned, style-constrained) generation. The
 * anchor carries what the model needs to reproduce the style: identity, the
 * mandatory family, the verbatim protocol-gap notes, and a digest of the
 * recipe's slot structure. It deliberately carries no geometry — the
 * deterministic compiler stays the only place semantics become rectangles.
 */
export const styleAnchorSchema = z
  .object({
    styleId: z.string().min(1),
    family: templateRecipeFamilySchema,
    styleNotes: z.string(),
    slotSummary: z.string().min(1),
  })
  .strict();

export type StyleAnchor = z.infer<typeof styleAnchorSchema>;

/**
 * Slot-id outline a compiled recipe of this family produces, mirroring the
 * compiler's slot naming (`compileTemplateRecipe` + family planners): the
 * diagonal family carries two heroes, layered-collage starts with a
 * background, everything else is one hero plus supports.
 */
function slotIdOutline(recipe: TemplateRecipe): string[] {
  const supports = Array.from(
    { length: recipe.supportCount },
    (_, index) => `support-${index + 1}`,
  );
  switch (recipe.family) {
    case "diagonal-collage":
      return ["hero", "hero-2", ...supports];
    case "layered-collage":
      return ["background", "hero", ...supports];
    default:
      return ["hero", ...supports];
  }
}

/** Human-readable digest of a recipe's slot structure for prompt anchoring. */
export function summarizeRecipeSlots(recipe: TemplateRecipe): string {
  const segments = [
    `${recipe.profile} ${recipe.family}`,
    `hero ${recipe.heroPosition} share ${recipe.heroShare}`,
    `supports ×${recipe.supportCount}`,
    `rhythm ${recipe.rhythm}`,
    `boundary ${recipe.boundary}`,
    ...(recipe.layering ? [`layering ${recipe.layering}`] : []),
    `margin ${recipe.margin} gap ${recipe.gap} corner ${recipe.cornerRadius}`,
    ...(recipe.diagonal
      ? [
          `diagonal axis ${recipe.diagonal.axis} heroShare ${recipe.diagonal.heroShare} supportShare ${recipe.diagonal.supportShare} overlap ${recipe.diagonal.overlap} bg ${
            recipe.diagonal.backgroundColor ?? "transparent"
          }`,
        ]
      : []),
    `slots ${slotIdOutline(recipe).join(", ")}`,
    ...(recipe.slotIntents
      ? [`slotIntents ${Object.keys(recipe.slotIntents).join(", ")}`]
      : []),
  ];
  return segments.join("; ");
}

export function buildStyleAnchor(style: StyleLibraryEntry): StyleAnchor {
  return styleAnchorSchema.parse({
    styleId: style.id,
    family: style.recipe.family,
    styleNotes: style.styleNotes,
    slotSummary: summarizeRecipeSlots(style.recipe),
  });
}
