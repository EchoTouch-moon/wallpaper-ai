import { z } from "zod";
import {
  editorProjectSchema,
  imageAssetAnalysisSchema,
  layoutCandidateSchema,
  wallpaperLayoutSchema,
  wallpaperTemplateSchema,
} from "./layoutSchema.ts";

export {
  editorProjectSchema,
  imageAssetAnalysisSchema,
  layoutCandidateSchema,
  wallpaperLayoutSchema,
  wallpaperTemplateSchema,
} from "./layoutSchema.ts";

export type ImageAssetAnalysis = z.infer<typeof imageAssetAnalysisSchema>;
export type WallpaperTemplate = z.infer<typeof wallpaperTemplateSchema>;
export type WallpaperLayout = z.infer<typeof wallpaperLayoutSchema>;
export type WallpaperLayoutInput = z.input<typeof wallpaperLayoutSchema>;
export type WallpaperItem = WallpaperLayout["items"][number];
export type LayoutCandidate = z.infer<typeof layoutCandidateSchema>;
export type EditorProject = z.infer<typeof editorProjectSchema>;
export type TemplateType = WallpaperTemplate["type"];
