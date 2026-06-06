import { create } from "zustand";
import { getRatioPreset } from "@/lib/wallpaper/ratios";
import type { ImageAsset } from "@/types/asset";
import type { CanvasObjectSnapshot, CanvasSize } from "@/types/canvas";
import type { CompositionIntent } from "@/types/layout";
import type { WallpaperRatioId } from "@/types/wallpaper";

interface EditorState {
  ratioId: WallpaperRatioId;
  canvasSize: CanvasSize;
  assets: ImageAsset[];
  selectedObjectId: string | null;
  selectedObject: CanvasObjectSnapshot | null;
  objectCount: number;
  previewScale: number;
  isCanvasReady: boolean;
  notice: string | null;
  exportStatus: "idle" | "exporting" | "success" | "error";
  exportError: string | null;
  isAssetPanelOpen: boolean;
  isInspectorOpen: boolean;
  compositionIntent: CompositionIntent;
  setRatio: (ratioId: WallpaperRatioId) => void;
  addAssets: (assets: ImageAsset[]) => void;
  removeAsset: (assetId: string) => void;
  setCanvasSnapshot: (snapshot: {
    objectCount: number;
    selectedObject: CanvasObjectSnapshot | null;
  }) => void;
  setPreviewScale: (scale: number) => void;
  setCanvasReady: (isReady: boolean) => void;
  setNotice: (notice: string | null) => void;
  setExportState: (
    exportStatus: EditorState["exportStatus"],
    exportError: string | null,
  ) => void;
  toggleAssetPanel: () => void;
  toggleInspector: () => void;
  toggleFocusMode: () => void;
  setCompositionIntent: (intent: CompositionIntent) => void;
  resetEditor: () => void;
}

const defaultRatio = getRatioPreset("16:9");

export const useEditorStore = create<EditorState>((set) => ({
  ratioId: defaultRatio.id,
  canvasSize: {
    width: defaultRatio.width,
    height: defaultRatio.height,
  },
  assets: [],
  selectedObjectId: null,
  selectedObject: null,
  objectCount: 0,
  previewScale: 1,
  isCanvasReady: false,
  notice: null,
  exportStatus: "idle",
  exportError: null,
  isAssetPanelOpen: true,
  isInspectorOpen: true,
  compositionIntent: "hero-with-support",
  setRatio: (ratioId) => {
    const ratio = getRatioPreset(ratioId);
    set({
      ratioId: ratio.id,
      canvasSize: {
        width: ratio.width,
        height: ratio.height,
      },
      exportStatus: "idle",
      exportError: null,
    });
  },
  addAssets: (assets) => set((state) => ({ assets: [...state.assets, ...assets] })),
  removeAsset: (assetId) =>
    set((state) => ({
      assets: state.assets.filter((asset) => asset.id !== assetId),
    })),
  setCanvasSnapshot: ({ objectCount, selectedObject }) =>
    set({
      objectCount,
      selectedObject,
      selectedObjectId: selectedObject?.id || null,
    }),
  setPreviewScale: (previewScale) => set({ previewScale }),
  setCanvasReady: (isCanvasReady) => set({ isCanvasReady }),
  setNotice: (notice) => set({ notice }),
  setExportState: (exportStatus, exportError) => set({ exportStatus, exportError }),
  toggleAssetPanel: () =>
    set((state) => ({ isAssetPanelOpen: !state.isAssetPanelOpen })),
  toggleInspector: () =>
    set((state) => ({ isInspectorOpen: !state.isInspectorOpen })),
  toggleFocusMode: () =>
    set((state) => {
      const shouldOpen = !state.isAssetPanelOpen && !state.isInspectorOpen;
      return {
        isAssetPanelOpen: shouldOpen,
        isInspectorOpen: shouldOpen,
      };
    }),
  setCompositionIntent: (compositionIntent) => set({ compositionIntent }),
  resetEditor: () =>
    set({
      assets: [],
      selectedObjectId: null,
      selectedObject: null,
      objectCount: 0,
      notice: null,
      exportStatus: "idle",
      exportError: null,
    }),
}));
