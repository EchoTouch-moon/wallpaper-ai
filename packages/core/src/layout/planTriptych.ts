import { generateTemplateCandidates } from "./planTemplate.ts";
import { WALLPAPER_TEMPLATES } from "./templates.ts";
import type { CanvasSize } from "../types/canvas";
import type { ImageAssetAnalysis } from "../types/layout";
import type { WallpaperRatioId } from "../types/wallpaper";

export function generateTriptychCandidates(
  analyses: ImageAssetAnalysis[],
  canvasSize: CanvasSize,
  ratioId: WallpaperRatioId,
) {
  const templates = WALLPAPER_TEMPLATES.filter(
    (template) =>
      template.type === "triptych" && template.supportedRatios.includes(ratioId),
  );

  return generateTemplateCandidates(analyses, canvasSize, ratioId, templates);
}
