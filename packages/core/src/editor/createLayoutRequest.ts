import type {
  GenerateLayoutMode,
  GenerateLayoutRequest,
} from "../types/generateLayout";
import type {
  CompositionIntent,
  ImageAssetAnalysis,
  WallpaperLayout,
} from "../types/layout";
import type { CanvasSize } from "../types/canvas";
import type { WallpaperRatioId } from "../types/wallpaper";

interface CreateLayoutRequestInput {
  operation: "generate" | "refine";
  mode: GenerateLayoutMode;
  canvasSize: CanvasSize;
  ratioId: WallpaperRatioId;
  compositionIntent: CompositionIntent;
  assets: ImageAssetAnalysis[];
  currentLayout: WallpaperLayout | null;
  userPrompt?: string;
}

export function createEditorLayoutRequest({
  operation,
  mode,
  canvasSize,
  ratioId,
  compositionIntent,
  assets,
  currentLayout,
  userPrompt,
}: CreateLayoutRequestInput): GenerateLayoutRequest {
  const candidateCount = operation === "refine" ? 1 : 3;
  return {
    operation,
    canvas: {
      width: canvasSize.width,
      height: canvasSize.height,
      ratioId,
    },
    intent: {
      mode,
      style: "auto",
      compositionIntent,
      count: candidateCount,
      userPrompt:
        operation === "refine" ? userPrompt?.trim() : undefined,
    },
    assets,
    currentLayout:
      operation === "refine" ? (currentLayout ?? undefined) : undefined,
    options: {
      candidateCount,
      allowFallback: true,
      strictValidation: true,
    },
  };
}
