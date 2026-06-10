import { groupAssetsByColor } from "../image/colorGroup.ts";
import { WALLPAPER_TEMPLATES } from "../layout/templates.ts";
import type { ImageAssetAnalysis, TemplateType } from "@/types/layout";
import type {
  GenerateLayoutRequest,
  GenerateLayoutStyle,
} from "@/types/generateLayout";

const STYLE_TO_TEMPLATE_TYPE: Record<
  Exclude<GenerateLayoutStyle, "auto">,
  TemplateType
> = {
  "same-tone-triptych": "triptych",
  "layered-moodboard": "layered-moodboard",
  "portrait-triptych": "portrait-triptych",
  "irregular-collage": "irregular-collage",
};

function preferredTypeForAssets(assets: ImageAssetAnalysis[]): TemplateType {
  const portraitSignals = assets.filter(
    (asset) =>
      asset.contentType === "portrait" ||
      asset.faces?.length ||
      asset.bestUse?.includes("portrait-collage"),
  ).length;

  if (portraitSignals >= 2) {
    return "portrait-triptych";
  }

  if (assets.length >= 5) {
    return "irregular-collage";
  }

  const strongestColorGroup = groupAssetsByColor(assets)[0];
  if (
    strongestColorGroup &&
    strongestColorGroup.assets.length >= 3 &&
    strongestColorGroup.harmonyScore >= 0.82
  ) {
    return "triptych";
  }

  return "layered-moodboard";
}

export function selectTemplateTypes(request: GenerateLayoutRequest): TemplateType[] {
  const primary =
    request.intent.style === "auto"
      ? preferredTypeForAssets(request.assets)
      : STYLE_TO_TEMPLATE_TYPE[request.intent.style];
  const ordered: TemplateType[] = [
    primary,
    "triptych",
    "layered-moodboard",
    "irregular-collage",
    "portrait-triptych",
  ];

  return [...new Set(ordered)];
}

export function selectTemplates(request: GenerateLayoutRequest) {
  const preferredTypes = selectTemplateTypes(request);
  const supported = WALLPAPER_TEMPLATES.filter((template) =>
    template.supportedRatios.includes(request.canvas.ratioId),
  );

  return supported.sort((left, right) => {
    const leftIndex = preferredTypes.indexOf(left.type);
    const rightIndex = preferredTypes.indexOf(right.type);
    return leftIndex - rightIndex;
  });
}
