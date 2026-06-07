import { z } from "zod";

const normalizedNumberSchema = z.number().min(0).max(1);

export const normalizedPointSchema = z.object({
  x: normalizedNumberSchema,
  y: normalizedNumberSchema,
});

export const normalizedBoxSchema = z
  .object({
    x: normalizedNumberSchema,
    y: normalizedNumberSchema,
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((box) => box.x + box.width <= 1 && box.y + box.height <= 1, {
    message: "Normalized box must remain inside its container",
  });

export const imageAssetAnalysisSchema = z.object({
  assetId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  orientation: z.enum(["portrait", "landscape", "square"]),
  aspectRatio: z.number().positive(),
  resolutionScore: normalizedNumberSchema,
  dominantColors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).length(3),
  averageColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  brightness: normalizedNumberSchema,
  saturation: normalizedNumberSchema,
  contrast: normalizedNumberSchema,
  contentType: z
    .enum([
      "portrait",
      "landscape",
      "anime",
      "pet",
      "architecture",
      "object",
      "text-heavy",
      "unknown",
    ])
    .optional(),
  faces: z.array(normalizedBoxSchema).optional(),
  subjectBox: normalizedBoxSchema.optional(),
  saliencyCenter: normalizedPointSchema.optional(),
  styleTags: z.array(z.string()).optional(),
  bestUse: z
    .array(
      z.enum([
        "hero",
        "background",
        "support",
        "triptych",
        "portrait-collage",
        "irregular-collage",
      ]),
    )
    .optional(),
  cropSafety: z.enum(["high", "medium", "low"]).optional(),
});

export const safeAreaSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "desktop-icons-left",
    "desktop-icons-right",
    "desktop-dock",
    "mobile-clock",
    "mobile-widget-center",
    "subject-protection",
  ]),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const templateTypeSchema = z.enum([
  "triptych",
  "layered-moodboard",
  "portrait-triptych",
  "irregular-collage",
]);

export const templateSlotSchema = z.object({
  id: z.string().min(1),
  x: normalizedNumberSchema,
  y: normalizedNumberSchema,
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
  rotation: z.number().min(-180).max(180).default(0),
  zIndex: z.number().int(),
  role: z.enum(["hero", "support", "background", "decorative"]),
  shape: z.enum(["rect", "rounded-rect", "polygon"]),
  radius: normalizedNumberSchema.optional(),
  polygon: z.array(normalizedPointSchema).min(3).optional(),
  safeZone: normalizedBoxSchema.optional(),
});

export const wallpaperTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: templateTypeSchema,
    supportedRatios: z.array(z.string()).min(1),
    minImages: z.number().int().positive(),
    maxImages: z.number().int().positive(),
    slots: z.array(templateSlotSchema).min(1),
  })
  .superRefine((template, context) => {
    if (template.minImages > template.maxImages) {
      context.addIssue({
        code: "custom",
        message: "minImages cannot exceed maxImages",
        path: ["minImages"],
      });
    }
    const ids = new Set<string>();
    template.slots.forEach((slot, index) => {
      if (ids.has(slot.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate slot id: ${slot.id}`,
          path: ["slots", index, "id"],
        });
      }
      ids.add(slot.id);
      if (slot.x + slot.width > 1 || slot.y + slot.height > 1) {
        context.addIssue({
          code: "custom",
          message: "Template slot must remain inside the normalized canvas",
          path: ["slots", index],
        });
      }
      if (slot.shape === "polygon" && !slot.polygon) {
        context.addIssue({
          code: "custom",
          message: "Polygon slots require polygon points",
          path: ["slots", index, "polygon"],
        });
      }
    });
  });

export const cropConfigSchema = normalizedBoxSchema.extend({
  focalPoint: normalizedPointSchema.optional(),
});

export const maskConfigSchema = z.object({
  type: z.enum(["rect", "rounded-rect", "polygon"]),
  radius: z.number().nonnegative().optional(),
  polygon: z.array(normalizedPointSchema).min(3).optional(),
});

export const itemStyleSchema = z.object({
  radius: z.number().nonnegative().optional(),
  shadow: z.enum(["none", "soft", "strong"]).optional(),
  border: z
    .object({
      width: z.number().nonnegative(),
      color: z.string().min(1),
    })
    .optional(),
  filter: z
    .object({
      brightness: z.number().min(-1).max(1).optional(),
      contrast: z.number().min(-1).max(1).optional(),
      saturation: z.number().min(-1).max(1).optional(),
      blur: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export const wallpaperItemSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  slotId: z.string().min(1).optional(),
  role: z.enum(["hero", "support", "background", "decorative"]),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().min(-180).max(180),
  zIndex: z.number().int(),
  opacity: normalizedNumberSchema,
  fit: z.enum(["cover", "contain"]),
  crop: cropConfigSchema.optional(),
  mask: maskConfigSchema.optional(),
  style: itemStyleSchema.optional(),
});

export const boundaryTreatmentSchema = z.object({
  type: z.enum([
    "edge-to-edge",
    "clean-gap",
    "hairline",
    "soft-shadow",
    "overlap",
    "feather",
    "paper-edge",
  ]),
  gap: z.number().nonnegative(),
  radius: z.number().nonnegative(),
  width: z.number().nonnegative(),
  color: z.string().optional(),
});

export const imageTransitionSchema = z.object({
  type: z.enum([
    "soft-gradient",
    "blurred-extension",
    "overlap-shadow",
    "shared-color-wash",
    "clean-gap",
  ]),
  strength: normalizedNumberSchema,
  feather: z.number().nonnegative(),
  color: z.string().optional(),
});

export const wallpaperLayoutSchema = z
  .object({
    version: z.literal("1.0"),
    canvas: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      ratio: z.string().min(1),
      usage: z.enum(["desktop", "mobile", "ultrawide", "custom"]),
      backgroundColor: z.string().min(1),
    }),
    template: z
      .object({
        id: z.string().min(1),
        type: templateTypeSchema,
      })
      .optional(),
    items: z.array(wallpaperItemSchema),
    safeAreas: z.array(safeAreaSchema).default([]),
    guidance: z.object({
      intent: z.enum([
        "single-hero",
        "hero-with-support",
        "balanced-collage",
        "story-strip",
      ]),
      focalAssetId: z.string().optional(),
      visualFlow: z.enum([
        "left-to-right",
        "right-to-left",
        "top-to-bottom",
        "center-out",
      ]),
      transition: imageTransitionSchema,
      boundary: boundaryTreatmentSchema,
      preserveFaces: z.boolean(),
      preserveNegativeSpace: z.boolean(),
    }),
    notes: z.array(z.string()).default([]),
  })
  .superRefine((layout, context) => {
    const ids = new Set<string>();
    layout.items.forEach((item, index) => {
      if (ids.has(item.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate item id: ${item.id}`,
          path: ["items", index, "id"],
        });
      }
      ids.add(item.id);
    });
  });

export const layoutCandidateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  reason: z.string().min(1),
  harmonyScore: normalizedNumberSchema,
  usedFallback: z.boolean(),
  layout: wallpaperLayoutSchema,
});

export const editorProjectSchema = z
  .object({
    version: z.literal("1.0"),
    id: z.string().min(1),
    name: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    ratioId: z.enum(["16:9", "16:10", "21:9", "9:16", "9:19.5"]),
    assetIds: z.array(z.string()),
    analyses: z.array(imageAssetAnalysisSchema),
    candidates: z.array(layoutCandidateSchema),
    currentLayout: wallpaperLayoutSchema.nullable(),
  })
  .superRefine((project, context) => {
    const assetIds = new Set<string>();
    project.assetIds.forEach((assetId, index) => {
      if (assetIds.has(assetId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate asset id: ${assetId}`,
          path: ["assetIds", index],
        });
      }
      assetIds.add(assetId);
    });

    project.analyses.forEach((analysis, index) => {
      if (!assetIds.has(analysis.assetId)) {
        context.addIssue({
          code: "custom",
          message: `Analysis references unknown asset: ${analysis.assetId}`,
          path: ["analyses", index, "assetId"],
        });
      }
    });

    const layouts = [
      ...project.candidates.map((candidate) => candidate.layout),
      ...(project.currentLayout ? [project.currentLayout] : []),
    ];
    layouts.forEach((layout, layoutIndex) => {
      layout.items.forEach((item, itemIndex) => {
        if (!assetIds.has(item.assetId)) {
          context.addIssue({
            code: "custom",
            message: `Layout references unknown asset: ${item.assetId}`,
            path: ["layouts", layoutIndex, "items", itemIndex, "assetId"],
          });
        }
      });
    });
  });
