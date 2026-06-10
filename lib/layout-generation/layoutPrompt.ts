import { WALLPAPER_TEMPLATES } from "../layout/templates.ts";
import type { GenerateLayoutRequest } from "@/types/generateLayout";

export function createLayoutPrompt(request: GenerateLayoutRequest) {
  const templates = WALLPAPER_TEMPLATES.filter((template) =>
    template.supportedRatios.includes(request.canvas.ratioId),
  );

  return [
    "You are a Layout JSON generator for AI Wallpaper Studio.",
    "Return editable layout candidates only. Do not describe UI operations.",
    "Use only assetId values from the provided assets.",
    JSON.stringify(
      {
        canvas: request.canvas,
        intent: request.intent,
        assets: request.assets.map((asset) => ({
          assetId: asset.assetId,
          width: asset.width,
          height: asset.height,
          orientation: asset.orientation,
          dominantColors: asset.dominantColors,
          averageColor: asset.averageColor,
          brightness: asset.brightness,
          saturation: asset.saturation,
          resolutionScore: asset.resolutionScore,
          contentType: asset.contentType,
          faces: asset.faces,
          subjectBox: asset.subjectBox,
          styleTags: asset.styleTags,
        })),
        templates,
        currentLayout: request.currentLayout,
      },
      null,
      2,
    ),
  ].join("\n\n");
}
