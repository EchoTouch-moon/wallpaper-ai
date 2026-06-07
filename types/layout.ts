import type {
  EditorProject,
  ImageAssetAnalysis,
  LayoutCandidate,
  TemplateType,
  WallpaperItem,
  WallpaperLayout,
  WallpaperTemplate,
} from "@/lib/layout/layoutTypes";

export type CompositionIntent = WallpaperLayout["guidance"]["intent"];
export type ImageTransition =
  WallpaperLayout["guidance"]["transition"];
export type ImageTransitionType = ImageTransition["type"];
export type BoundaryTreatment =
  WallpaperLayout["guidance"]["boundary"];
export type BoundaryTreatmentType = BoundaryTreatment["type"];
export type LayoutGuidance = WallpaperLayout["guidance"];

export type {
  EditorProject,
  ImageAssetAnalysis,
  LayoutCandidate,
  TemplateType,
  WallpaperItem,
  WallpaperLayout,
  WallpaperTemplate,
};
