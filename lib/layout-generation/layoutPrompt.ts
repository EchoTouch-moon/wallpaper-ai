import { WALLPAPER_TEMPLATES } from "../layout/templates.ts";
import type { GenerateLayoutRequest } from "@/types/generateLayout";

export const LAYOUT_MODEL_OUTPUT_SCHEMA = {
  type: "object",
  required: ["candidates"],
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        required: [
          "id",
          "label",
          "reason",
          "harmonyScore",
          "usedFallback",
          "layout",
        ],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          reason: { type: "string" },
          harmonyScore: { type: "number", minimum: 0, maximum: 1 },
          usedFallback: { type: "boolean" },
          layout: {
            type: "object",
            description:
              "A complete WallpaperLayout JSON object matching the app layout schema.",
          },
        },
      },
    },
  },
} as const;

export function createLayoutPrompt(request: GenerateLayoutRequest) {
  const templates = WALLPAPER_TEMPLATES.filter((template) =>
    template.supportedRatios.includes(request.canvas.ratioId),
  );

  return [
    "You are a Layout JSON generator for AI Wallpaper Studio.",
    "Return editable layout candidates only. Do not describe UI operations.",
    "Use only assetId values from the provided assets.",
    "Never include image files, base64, object URLs, Fabric objects, or rendered images.",
    "Return strict JSON matching this output schema:",
    JSON.stringify(LAYOUT_MODEL_OUTPUT_SCHEMA, null, 2),
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
