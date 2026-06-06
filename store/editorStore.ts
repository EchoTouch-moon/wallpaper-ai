import { create } from "zustand";
import { getRatioPreset } from "@/lib/wallpaper/ratios";
import type { CanvasSize } from "@/types/canvas";
import type { WallpaperRatioId } from "@/types/wallpaper";

interface EditorState {
  ratioId: WallpaperRatioId;
  canvasSize: CanvasSize;
  previewScale: number;
  isCanvasReady: boolean;
  setRatio: (ratioId: WallpaperRatioId) => void;
  setPreviewScale: (scale: number) => void;
  setCanvasReady: (isReady: boolean) => void;
}

const defaultRatio = getRatioPreset("16:9");

export const useEditorStore = create<EditorState>((set) => ({
  ratioId: defaultRatio.id,
  canvasSize: {
    width: defaultRatio.width,
    height: defaultRatio.height,
  },
  previewScale: 1,
  isCanvasReady: false,
  setRatio: (ratioId) => {
    const ratio = getRatioPreset(ratioId);
    set({
      ratioId: ratio.id,
      canvasSize: {
        width: ratio.width,
        height: ratio.height,
      },
    });
  },
  setPreviewScale: (previewScale) => set({ previewScale }),
  setCanvasReady: (isCanvasReady) => set({ isCanvasReady }),
}));
