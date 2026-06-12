import { colorDistance, hexToHsl } from "../image/colorAnalysis.ts";
import { wallpaperLayoutSchema } from "./layoutSchema.ts";
import type { CanvasSize } from "@/types/canvas";
import type {
  CompositionIntent,
  ImageAssetAnalysis,
  LayoutCandidate,
  TemplateSlot,
  WallpaperItem,
  WallpaperTemplate,
} from "@/types/layout";
import type { WallpaperRatioId } from "@/types/wallpaper";
import { createSafeAreas } from "../wallpaper/layoutSafeAreas.ts";

export interface TemplatePlanInput {
  analyses: ImageAssetAnalysis[];
  canvasSize: CanvasSize;
  ratioId: WallpaperRatioId;
  template: WallpaperTemplate;
  templateIndex: number;
  intent?: CompositionIntent;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(Math.max(value, minimum), maximum);
}

function usageForRatio(ratioId: WallpaperRatioId) {
  if (ratioId === "9:16" || ratioId === "9:19.5") {
    return "mobile" as const;
  }
  return ratioId === "21:9" ? ("ultrawide" as const) : ("desktop" as const);
}

export function calculateCoverCrop(
  analysis: ImageAssetAnalysis,
  slotWidth: number,
  slotHeight: number,
) {
  const sourceAspect = analysis.aspectRatio;
  const targetAspect = slotWidth / slotHeight;

  if (sourceAspect > targetAspect) {
    const width = targetAspect / sourceAspect;
    return {
      x: (1 - width) / 2,
      y: 0,
      width,
      height: 1,
      focalPoint: analysis.saliencyCenter ?? { x: 0.5, y: 0.5 },
    };
  }

  const height = sourceAspect / targetAspect;
  const isPortraitInLandscape =
    analysis.orientation === "portrait" && targetAspect > 1;
  const y = isPortraitInLandscape ? (1 - height) * 0.35 : (1 - height) / 2;
  return {
    x: 0,
    y,
    width: 1,
    height,
    focalPoint:
      analysis.saliencyCenter ?? { x: 0.5, y: isPortraitInLandscape ? 0.42 : 0.5 },
  };
}

function createItemStyle(template: WallpaperTemplate, slotIndex: number) {
  if (template.type === "layered-moodboard") {
    return {
      radius: 32,
      shadow: "strong" as const,
      border: { width: 1, color: "rgba(255,255,255,0.74)" },
    };
  }

  if (template.type === "irregular-collage") {
    return {
      radius: 22,
      shadow: "soft" as const,
      border: { width: 1, color: "rgba(255,255,255,0.8)" },
    };
  }

  if (template.id.includes("editorial") || template.type === "portrait-triptych") {
    return {
      radius: 28,
      shadow: "soft" as const,
      border: { width: 1, color: "rgba(255,255,255,0.72)" },
    };
  }

  if (template.id.includes("equal")) {
    return {
      radius: 0,
      shadow: "none" as const,
      border: {
        width: slotIndex === 1 ? 2 : 1,
        color: "rgba(255,255,255,0.78)",
      },
    };
  }

  return { radius: 0, shadow: "none" as const };
}

function boundaryForTemplate(template: WallpaperTemplate) {
  if (template.id.includes("cinematic")) {
    return { type: "edge-to-edge" as const, gap: 0, radius: 0, width: 0 };
  }

  if (template.type === "layered-moodboard") {
    return { type: "overlap" as const, gap: 0, radius: 32, width: 0 };
  }

  if (template.type === "irregular-collage") {
    return { type: "paper-edge" as const, gap: 18, radius: 22, width: 1 };
  }

  if (template.id.includes("editorial") || template.type === "portrait-triptych") {
    return { type: "soft-shadow" as const, gap: 36, radius: 28, width: 1 };
  }

  return { type: "clean-gap" as const, gap: 24, radius: 0, width: 1 };
}

function transitionForTemplate(template: WallpaperTemplate) {
  if (template.id.includes("cinematic")) {
    return { type: "soft-gradient" as const, strength: 0.45, feather: 32 };
  }

  if (template.type === "layered-moodboard") {
    return { type: "overlap-shadow" as const, strength: 0.5, feather: 48 };
  }

  if (template.type === "irregular-collage") {
    return { type: "shared-color-wash" as const, strength: 0.52, feather: 64 };
  }

  return { type: "clean-gap" as const, strength: 0.2, feather: 0 };
}

function intentForTemplate(
  template: WallpaperTemplate,
  intent: CompositionIntent | undefined,
) {
  if (intent) {
    return intent;
  }

  if (template.id.includes("editorial") || template.type === "portrait-triptych") {
    return "hero-with-support" as const;
  }

  if (template.id.includes("cinematic")) {
    return "story-strip" as const;
  }

  return "balanced-collage" as const;
}

function backgroundColorForTemplate(
  template: WallpaperTemplate,
  analyses: ImageAssetAnalysis[],
) {
  if (template.id.includes("cinematic")) {
    return "#10151d";
  }

  if (template.type === "layered-moodboard") {
    return analyses[0]?.averageColor ?? "#20242d";
  }

  return "#f4f3ed";
}

function orientationScore(slot: TemplateSlot, analysis: ImageAssetAnalysis) {
  const slotAspect = slot.width / slot.height;
  const slotOrientation =
    Math.abs(slotAspect - 1) < 0.12
      ? "square"
      : slotAspect > 1
        ? "landscape"
        : "portrait";

  if (analysis.orientation === slotOrientation) {
    return 1;
  }

  if (slot.role === "hero" && analysis.bestUse?.includes("hero")) {
    return 0.75;
  }

  return 0.45;
}

function roleScore(slot: TemplateSlot, analysis: ImageAssetAnalysis) {
  if (slot.role === "hero") {
    return (
      analysis.resolutionScore * 0.7 +
      (analysis.bestUse?.includes("hero") ? 0.3 : 0)
    );
  }

  if (slot.role === "background") {
    return (
      analysis.resolutionScore * 0.5 +
      (analysis.bestUse?.includes("background") ? 0.5 : 0)
    );
  }

  return analysis.resolutionScore * 0.6 + orientationScore(slot, analysis) * 0.4;
}

function selectAssetsForSlots(
  template: WallpaperTemplate,
  analyses: ImageAssetAnalysis[],
) {
  const sortedSlots = [...template.slots].sort(
    (left, right) =>
      right.zIndex - left.zIndex ||
      (right.role === "hero" ? 1 : 0) - (left.role === "hero" ? 1 : 0),
  );
  const assigned = new Map<string, ImageAssetAnalysis>();
  const usedAssetIds = new Set<string>();
  const theme = hexToHsl(
    [...analyses].sort(
      (left, right) => right.resolutionScore - left.resolutionScore,
    )[0].averageColor,
  );

  sortedSlots.forEach((slot) => {
    const candidates = analyses
      .filter((analysis) => !usedAssetIds.has(analysis.assetId))
      .sort((left, right) => {
        const leftScore =
          roleScore(slot, left) * 0.65 +
          (1 - colorDistance(hexToHsl(left.averageColor), theme)) * 0.35;
        const rightScore =
          roleScore(slot, right) * 0.65 +
          (1 - colorDistance(hexToHsl(right.averageColor), theme)) * 0.35;
        return rightScore - leftScore;
      });
    const selected = candidates[0] ?? analyses[assigned.size % analyses.length];
    assigned.set(slot.id, selected);
    usedAssetIds.add(selected.assetId);
  });

  return assigned;
}

function createLayoutItem(
  template: WallpaperTemplate,
  slot: TemplateSlot,
  slotIndex: number,
  analysis: ImageAssetAnalysis,
  canvasSize: CanvasSize,
  templateIndex: number,
): WallpaperItem {
  const width = Math.round(slot.width * canvasSize.width);
  const height = Math.round(slot.height * canvasSize.height);

  return {
    id: `layout_${templateIndex + 1}_${slot.id}`,
    assetId: analysis.assetId,
    slotId: slot.id,
    role: slot.role,
    x: Math.round(slot.x * canvasSize.width),
    y: Math.round(slot.y * canvasSize.height),
    width,
    height,
    rotation: slot.rotation,
    zIndex: slot.zIndex,
    opacity: slot.role === "decorative" ? 0.92 : 1,
    fit: "cover",
    crop: calculateCoverCrop(analysis, width, height),
    mask: {
      type: slot.shape,
      radius:
        slot.shape === "rounded-rect"
          ? Math.round(
              (slot.radius ?? 0) *
                Math.min(canvasSize.width, canvasSize.height),
            )
          : undefined,
      polygon: slot.polygon,
    },
    style: createItemStyle(template, slotIndex),
  };
}

export function planTemplateCandidate({
  analyses,
  canvasSize,
  ratioId,
  template,
  templateIndex,
  intent,
}: TemplatePlanInput): LayoutCandidate {
  const assetsBySlot = selectAssetsForSlots(template, analyses);
  const items = template.slots.map((slot, slotIndex) => {
    const analysis = assetsBySlot.get(slot.id);
    if (!analysis) {
      throw new Error(`Missing analysis for template slot: ${slot.id}`);
    }
    return createLayoutItem(
      template,
      slot,
      slotIndex,
      analysis,
      canvasSize,
      templateIndex,
    );
  });
  const focalAssetId =
    items.find((item) => item.role === "hero")?.assetId ?? items[0]?.assetId;
  const harmonyScore = clamp(
    items.reduce((total, item) => {
      const analysis = analyses.find((candidate) => candidate.assetId === item.assetId);
      return total + (analysis?.resolutionScore ?? 0.5);
    }, 0) / Math.max(items.length, 1),
  );
  const usage = usageForRatio(ratioId);
  const layout = wallpaperLayoutSchema.parse({
    version: "1.0",
    canvas: {
      width: canvasSize.width,
      height: canvasSize.height,
      ratio: ratioId,
      usage,
      backgroundColor: backgroundColorForTemplate(template, analyses),
    },
    template: { id: template.id, type: template.type },
    items,
    safeAreas: createSafeAreas(ratioId, canvasSize.width, canvasSize.height),
    guidance: {
      intent: intentForTemplate(template, intent),
      focalAssetId,
      visualFlow: usage === "mobile" ? "top-to-bottom" : "left-to-right",
      transition: transitionForTemplate(template),
      boundary: boundaryForTemplate(template),
      preserveFaces: true,
      preserveNegativeSpace: template.type !== "irregular-collage",
    },
    notes: [
      `${template.name} matched ${items.length} template slots to the highest scoring analyzed assets.`,
    ],
  });

  return {
    id: `candidate_${template.id}`,
    label: template.name,
    reason: `${template.name} uses ${template.type} slots to turn analyzed image traits into editable Layout JSON.`,
    harmonyScore,
    usedFallback: new Set(items.map((item) => item.assetId)).size < items.length,
    layout,
  };
}

export function generateTemplateCandidates(
  analyses: ImageAssetAnalysis[],
  canvasSize: CanvasSize,
  ratioId: WallpaperRatioId,
  templates: WallpaperTemplate[],
  intent?: CompositionIntent,
) {
  return templates.map((template, templateIndex) =>
    planTemplateCandidate({
      analyses,
      canvasSize,
      ratioId,
      template,
      templateIndex,
      intent,
    }),
  );
}
