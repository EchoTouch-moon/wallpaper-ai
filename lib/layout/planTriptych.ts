import { selectTriptychAssets } from "../image/colorGroup.ts";
import { wallpaperLayoutSchema } from "./layoutSchema.ts";
import { WALLPAPER_TEMPLATES } from "./templates.ts";
import type {
  ImageAssetAnalysis,
  LayoutCandidate,
  WallpaperItem,
  WallpaperTemplate,
} from "@/types/layout";
import type { CanvasSize } from "@/types/canvas";
import type { WallpaperRatioId } from "@/types/wallpaper";
import { createSafeAreas } from "../wallpaper/layoutSafeAreas.ts";

function usageForRatio(ratioId: WallpaperRatioId) {
  if (ratioId === "9:16" || ratioId === "9:19.5") {
    return "mobile" as const;
  }
  return ratioId === "21:9" ? ("ultrawide" as const) : ("desktop" as const);
}

function calculateCrop(
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
      focalPoint: { x: 0.5, y: 0.5 },
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
    focalPoint: { x: 0.5, y: isPortraitInLandscape ? 0.42 : 0.5 },
  };
}

function createItemStyle(template: WallpaperTemplate, slotIndex: number) {
  if (template.id.includes("editorial")) {
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
  if (template.id.includes("editorial")) {
    return { type: "soft-shadow" as const, gap: 36, radius: 28, width: 1 };
  }
  return { type: "clean-gap" as const, gap: 24, radius: 0, width: 1 };
}

export function generateTriptychCandidates(
  analyses: ImageAssetAnalysis[],
  canvasSize: CanvasSize,
  ratioId: WallpaperRatioId,
): LayoutCandidate[] {
  const selection = selectTriptychAssets(analyses);
  const analysisById = new Map(analyses.map((analysis) => [analysis.assetId, analysis]));
  const templates = WALLPAPER_TEMPLATES.filter((template) =>
    template.supportedRatios.includes(ratioId),
  );

  return templates.map((template, templateIndex) => {
    const items = template.slots.map((slot, slotIndex): WallpaperItem => {
      const assetId = selection.assetIds[slotIndex];
      const analysis = analysisById.get(assetId);
      if (!analysis) {
        throw new Error(`Missing analysis for ${assetId}`);
      }
      const width = Math.round(slot.width * canvasSize.width);
      const height = Math.round(slot.height * canvasSize.height);

      return {
        id: `layout_${templateIndex + 1}_${slot.id}`,
        assetId,
        slotId: slot.id,
        role: slot.role,
        x: Math.round(slot.x * canvasSize.width),
        y: Math.round(slot.y * canvasSize.height),
        width,
        height,
        rotation: slot.rotation,
        zIndex: slot.zIndex,
        opacity: 1,
        fit: "cover",
        crop: calculateCrop(analysis, width, height),
        mask: {
          type: slot.shape,
          radius:
            slot.shape === "rounded-rect"
              ? Math.round((slot.radius ?? 0) * Math.min(canvasSize.width, canvasSize.height))
              : undefined,
          polygon: slot.polygon,
        },
        style: createItemStyle(template, slotIndex),
      };
    });
    const boundary = boundaryForTemplate(template);
    const layout = wallpaperLayoutSchema.parse({
      version: "1.0",
      canvas: {
        width: canvasSize.width,
        height: canvasSize.height,
        ratio: ratioId,
        usage: usageForRatio(ratioId),
        backgroundColor: template.id.includes("cinematic")
          ? "#10151d"
          : "#f4f3ed",
      },
      template: { id: template.id, type: template.type },
      items,
      safeAreas: createSafeAreas(ratioId, canvasSize.width, canvasSize.height),
      guidance: {
        intent: template.id.includes("editorial")
          ? "hero-with-support"
          : "balanced-collage",
        focalAssetId: selection.assetIds[0],
        visualFlow:
          usageForRatio(ratioId) === "mobile" ? "top-to-bottom" : "left-to-right",
        transition: {
          type: template.id.includes("cinematic") ? "soft-gradient" : "clean-gap",
          strength: template.id.includes("cinematic") ? 0.45 : 0.2,
          feather: template.id.includes("cinematic") ? 32 : 0,
        },
        boundary,
        preserveFaces: true,
        preserveNegativeSpace: true,
      },
      notes: [selection.reason],
    });

    return {
      id: `candidate_${template.id}`,
      label: template.name,
      reason: `${selection.reason} ${
        template.id.includes("editorial")
          ? "A dominant image creates a clear editorial hierarchy."
          : template.id.includes("cinematic")
            ? "Edge-to-edge crops create the strongest visual continuity."
            : "Equal spacing keeps the color story calm and structured."
      }`,
      harmonyScore: selection.harmonyScore,
      usedFallback: selection.usedFallback,
      layout,
    };
  });
}
