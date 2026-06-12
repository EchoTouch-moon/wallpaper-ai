import type {
  CompositionIntent,
  ImageAssetAnalysis,
  LayoutCandidate,
  WallpaperLayout,
} from "@/types/layout";
import type { WallpaperRatioId } from "@/types/wallpaper";
import type { AiLayoutOperation } from "@/lib/layout-generation/aiPlanSchema";

export type GenerateLayoutMode = "template" | "mock-ai" | "ai";

export type GenerateLayoutStyle =
  | "same-tone-triptych"
  | "layered-moodboard"
  | "portrait-triptych"
  | "irregular-collage"
  | "auto";

export type GenerateLayoutSource =
  | "template"
  | "mock-ai"
  | "ai"
  | "fallback";

export interface GenerateLayoutRequest {
  operation?: AiLayoutOperation;
  canvas: {
    width: number;
    height: number;
    ratioId: WallpaperRatioId;
  };
  intent: {
    mode: GenerateLayoutMode;
    style: GenerateLayoutStyle;
    compositionIntent?: CompositionIntent;
    safeArea?: "none" | "desktop-left" | "mobile-top" | "desktop-bottom";
    count?: number;
    userPrompt?: string;
  };
  assets: ImageAssetAnalysis[];
  currentLayout?: WallpaperLayout;
  options?: {
    candidateCount?: number;
    allowFallback?: boolean;
    strictValidation?: boolean;
  };
}

export interface RejectedLayoutCandidate {
  candidateId: string;
  source: Exclude<GenerateLayoutSource, "fallback">;
  reason: string;
  validationErrors?: string[];
}

export interface GenerateLayoutResponse {
  candidates: LayoutCandidate[];
  rejected: RejectedLayoutCandidate[];
  source: GenerateLayoutSource;
  warnings?: string[];
}
