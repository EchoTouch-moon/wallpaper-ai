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

function hasDesktopHeroSignal(request: GenerateLayoutRequest) {
  const isDesktop =
    request.canvas.ratioId === "16:9" ||
    request.canvas.ratioId === "16:10" ||
    request.canvas.ratioId === "21:9";

  if (!isDesktop) {
    return false;
  }

  return request.assets.some(
    (asset) =>
      asset.orientation === "landscape" &&
      asset.resolutionScore >= 0.86 &&
      (asset.bestUse?.includes("hero") ||
        asset.bestUse?.includes("background") ||
        asset.aspectRatio >= 1.65),
  );
}

function hasPortraitSignals(assets: ImageAssetAnalysis[]) {
  const portraitSignals = assets.filter(
    (asset) =>
      asset.contentType === "portrait" ||
      asset.faces?.length ||
      asset.bestUse?.includes("portrait-collage"),
  ).length;

  return portraitSignals >= 2;
}

function hasStrongColorGroup(assets: ImageAssetAnalysis[]) {
  const strongestColorGroup = groupAssetsByColor(assets)[0];
  return Boolean(
    strongestColorGroup &&
      strongestColorGroup.assets.length >= 3 &&
      strongestColorGroup.harmonyScore >= 0.82,
  );
}

function preferredTypeForAssets(request: GenerateLayoutRequest): TemplateType {
  const { assets } = request;

  if (hasPortraitSignals(assets)) {
    return "portrait-triptych";
  }

  if (assets.length >= 5) {
    return "irregular-collage";
  }

  if (hasStrongColorGroup(assets)) {
    return "triptych";
  }

  if (hasDesktopHeroSignal(request)) {
    return "layered-moodboard";
  }

  return "layered-moodboard";
}

export function selectTemplateTypes(request: GenerateLayoutRequest): TemplateType[] {
  const primary =
    request.intent.style === "auto"
      ? preferredTypeForAssets(request)
      : STYLE_TO_TEMPLATE_TYPE[request.intent.style];
  const intentSecondary: TemplateType[] =
    request.intent.compositionIntent === "single-hero" ||
    request.intent.compositionIntent === "hero-with-support"
      ? ["layered-moodboard", "triptych"]
      : request.intent.compositionIntent === "story-strip"
        ? ["triptych", "irregular-collage"]
        : request.intent.compositionIntent === "balanced-collage"
          ? ["triptych", "irregular-collage"]
          : [];
  const contentSecondary: TemplateType[] = [
    hasDesktopHeroSignal(request) ? "layered-moodboard" : primary,
    hasStrongColorGroup(request.assets) ? "triptych" : primary,
    request.assets.length >= 5 ? "irregular-collage" : primary,
    hasPortraitSignals(request.assets) ? "portrait-triptych" : primary,
  ];
  const ordered: TemplateType[] = [
    primary,
    ...intentSecondary,
    ...contentSecondary,
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
