import { create } from "zustand";
import {
  commitHistory,
  redoHistory,
  undoHistory,
} from "@wallpaper/core/editor";
import { getRatioPreset } from "@wallpaper/core/wallpaper";
import type { ImageAsset } from "@wallpaper/core/types";
import type {
  CanvasObjectSnapshot,
  CanvasSize,
  CropSession,
  SnapGuides,
} from "@wallpaper/core/types";
import type {
  CompositionIntent,
  EditorProject,
  LayoutCandidate,
  WallpaperLayout,
} from "@wallpaper/core/types";
import type { WallpaperRatioId } from "@wallpaper/core/types";
import type {
  GenerateLayoutResponse,
  GenerateLayoutSource,
} from "@wallpaper/core/types";

type LayoutSession = NonNullable<GenerateLayoutResponse["session"]>;

interface EditorState {
  ratioId: WallpaperRatioId;
  canvasSize: CanvasSize;
  assets: ImageAsset[];
  selectedObjectId: string | null;
  selectedObject: CanvasObjectSnapshot | null;
  objectCount: number;
  hasBackdrop: boolean;
  snapGuides: SnapGuides;
  cropSession: CropSession | null;
  previewScale: number;
  isCanvasReady: boolean;
  notice: string | null;
  exportStatus: "idle" | "exporting" | "success" | "error";
  exportError: string | null;
  isAssetPanelOpen: boolean;
  isInspectorOpen: boolean;
  compositionIntent: CompositionIntent;
  candidates: LayoutCandidate[];
  candidateSource: GenerateLayoutSource | null;
  layoutSession: LayoutSession | null;
  currentLayout: WallpaperLayout | null;
  historyPast: Array<WallpaperLayout | null>;
  historyFuture: Array<WallpaperLayout | null>;
  showSafeAreas: boolean;
  enableSnapping: boolean;
  isProjectHydrated: boolean;
  setRatio: (ratioId: WallpaperRatioId) => void;
  addAssets: (assets: ImageAsset[]) => void;
  removeAsset: (assetId: string) => void;
  setCanvasSnapshot: (snapshot: {
    objectCount: number;
    selectedObject: CanvasObjectSnapshot | null;
    hasBackdrop: boolean;
  }) => void;
  setSnapGuides: (guides: SnapGuides) => void;
  setCropSession: (session: CropSession | null) => void;
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
  setCandidates: (candidates: LayoutCandidate[]) => void;
  setCandidateSource: (source: GenerateLayoutSource | null) => void;
  setLayoutSession: (session: LayoutSession | null) => void;
  commitLayout: (layout: WallpaperLayout, addToHistory?: boolean) => void;
  undoLayout: () => WallpaperLayout | null | undefined;
  redoLayout: () => WallpaperLayout | null | undefined;
  toggleSafeAreas: () => void;
  toggleSnapping: () => void;
  hydrateProject: (assets: ImageAsset[], project: EditorProject) => void;
  markProjectHydrated: () => void;
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
  hasBackdrop: false,
  snapGuides: { vertical: [], horizontal: [] },
  cropSession: null,
  previewScale: 1,
  isCanvasReady: false,
  notice: null,
  exportStatus: "idle",
  exportError: null,
  isAssetPanelOpen: false,
  isInspectorOpen: false,
  compositionIntent: "hero-with-support",
  candidates: [],
  candidateSource: null,
  layoutSession: null,
  currentLayout: null,
  historyPast: [],
  historyFuture: [],
  showSafeAreas: true,
  enableSnapping: true,
  isProjectHydrated: false,
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
      candidates: [],
      candidateSource: null,
      layoutSession: null,
    });
  },
  addAssets: (assets) => set((state) => ({ assets: [...state.assets, ...assets] })),
  removeAsset: (assetId) =>
    set((state) => {
      const candidates = state.candidates.filter((candidate) =>
        candidate.layout.items.every((item) => item.assetId !== assetId),
      );
      return {
        assets: state.assets.filter((asset) => asset.id !== assetId),
        candidates,
        candidateSource: candidates.length > 0 ? state.candidateSource : null,
        layoutSession: null,
      };
    }),
  setCanvasSnapshot: ({ objectCount, selectedObject, hasBackdrop }) =>
    set({
      objectCount,
      selectedObject,
      selectedObjectId: selectedObject?.id || null,
      hasBackdrop,
    }),
  setSnapGuides: (snapGuides) => set({ snapGuides }),
  setCropSession: (cropSession) => set({ cropSession }),
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
  setCandidates: (candidates) => set({ candidates }),
  setCandidateSource: (candidateSource) => set({ candidateSource }),
  setLayoutSession: (layoutSession) => set({ layoutSession }),
  commitLayout: (layout, addToHistory = true) =>
    set((state) => {
      if (!addToHistory) {
        return { currentLayout: layout };
      }
      const history = commitHistory(
        {
          current: state.currentLayout,
          past: state.historyPast,
          future: state.historyFuture,
        },
        layout,
      );
      return {
        currentLayout: history.current,
        historyPast: history.past,
        historyFuture: history.future,
      };
    }),
  undoLayout: () => {
    let target: WallpaperLayout | null | undefined;
    set((state) => {
      const result = undoHistory({
        current: state.currentLayout,
        past: state.historyPast,
        future: state.historyFuture,
      });
      target = result.target;
      return {
        currentLayout: result.state.current,
        historyPast: result.state.past,
        historyFuture: result.state.future.slice(0, 50),
      };
    });
    return target;
  },
  redoLayout: () => {
    let target: WallpaperLayout | null | undefined;
    set((state) => {
      const result = redoHistory({
        current: state.currentLayout,
        past: state.historyPast,
        future: state.historyFuture,
      });
      target = result.target;
      return {
        currentLayout: result.state.current,
        historyPast: result.state.past.slice(-50),
        historyFuture: result.state.future,
      };
    });
    return target;
  },
  toggleSafeAreas: () =>
    set((state) => ({ showSafeAreas: !state.showSafeAreas })),
  toggleSnapping: () =>
    set((state) => ({ enableSnapping: !state.enableSnapping })),
  hydrateProject: (assets, project) => {
    const ratio = getRatioPreset(project.ratioId);
    set({
      ratioId: project.ratioId,
      canvasSize: { width: ratio.width, height: ratio.height },
      assets,
      candidates: project.candidates,
      candidateSource:
        project.candidates.length > 0
          ? (project.candidateSource ?? "template")
          : null,
      layoutSession: project.candidates.length > 0 ? project.layoutSession ?? null : null,
      currentLayout: project.currentLayout,
      historyPast: [],
      historyFuture: [],
      isProjectHydrated: true,
    });
  },
  markProjectHydrated: () => set({ isProjectHydrated: true }),
  resetEditor: () =>
    set({
      assets: [],
      selectedObjectId: null,
      selectedObject: null,
      objectCount: 0,
      hasBackdrop: false,
      snapGuides: { vertical: [], horizontal: [] },
      cropSession: null,
      notice: null,
      exportStatus: "idle",
      exportError: null,
      candidates: [],
      candidateSource: null,
      layoutSession: null,
      currentLayout: null,
      historyPast: [],
      historyFuture: [],
      showSafeAreas: true,
      enableSnapping: true,
      isProjectHydrated: false,
    }),
}));
