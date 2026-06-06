"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  FabricImage,
  FabricObject,
  filters,
  type Canvas as FabricCanvas,
} from "fabric";
import { downloadPng, renderCanvasPng } from "@/lib/fabric/exportCanvas";
import { useEditorStore } from "@/store/editorStore";
import type { ImageAsset } from "@/types/asset";
import type { CanvasObjectSnapshot } from "@/types/canvas";

interface EditorFabricObject extends FabricObject {
  objectId?: string;
  assetId?: string;
  role?: "hero" | "support" | "background";
}

export interface EditorCommands {
  registerCanvas: (canvas: FabricCanvas | null) => void;
  addImage: (asset: ImageAsset) => Promise<void>;
  removeAsset: (assetId: string) => void;
  deleteSelection: () => void;
  duplicateSelection: () => Promise<void>;
  moveSelectionForward: () => void;
  moveSelectionBackward: () => void;
  nudgeSelection: (x: number, y: number) => void;
  clearSelection: () => void;
  createBlurredBackdrop: () => Promise<void>;
  removeBackdrop: () => void;
  exportPng: () => Promise<void>;
}

const EditorContext = createContext<EditorCommands | null>(null);

FabricObject.customProperties = ["objectId", "assetId", "role"];

function createObjectId() {
  return `object_${crypto.randomUUID()}`;
}

function readObjectSnapshot(object: EditorFabricObject): CanvasObjectSnapshot {
  return {
    id: object.objectId ?? "",
    assetId: object.assetId,
    role: object.role,
    x: Math.round(object.left),
    y: Math.round(object.top),
    width: Math.round(object.getScaledWidth()),
    height: Math.round(object.getScaledHeight()),
    rotation: Math.round(object.angle),
    opacity: Math.round(object.opacity * 100),
  };
}

export function EditorProvider({ children }: Readonly<{ children: ReactNode }>) {
  const canvasRef = useRef<FabricCanvas | null>(null);
  const boundCanvasRef = useRef<FabricCanvas | null>(null);
  const notice = useEditorStore((state) => state.notice);
  const setNotice = useEditorStore((state) => state.setNotice);

  const syncCanvasState = useCallback(() => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject() as EditorFabricObject | undefined;

    useEditorStore.getState().setCanvasSnapshot({
      objectCount: canvas?.getObjects().length ?? 0,
      selectedObject: activeObject ? readObjectSnapshot(activeObject) : null,
      hasBackdrop:
        canvas?.getObjects().some((object) => {
          return (object as EditorFabricObject).role === "background";
        }) ?? false,
    });
  }, []);

  const fitBackdropToCanvas = useCallback((backdrop: FabricImage) => {
    const { canvasSize } = useEditorStore.getState();
    const scale = Math.max(
      canvasSize.width / (backdrop.width || 1),
      canvasSize.height / (backdrop.height || 1),
    );

    backdrop.set({
      left: canvasSize.width / 2,
      top: canvasSize.height / 2,
      originX: "center",
      originY: "center",
      scaleX: scale,
      scaleY: scale,
    });
    backdrop.setCoords();
  }, []);

  const registerCanvas = useCallback(
    (canvas: FabricCanvas | null) => {
      if (boundCanvasRef.current) {
        boundCanvasRef.current.off("selection:created", syncCanvasState);
        boundCanvasRef.current.off("selection:updated", syncCanvasState);
        boundCanvasRef.current.off("selection:cleared", syncCanvasState);
        boundCanvasRef.current.off("object:modified", syncCanvasState);
        boundCanvasRef.current.off("object:moving", syncCanvasState);
        boundCanvasRef.current.off("object:scaling", syncCanvasState);
        boundCanvasRef.current.off("object:rotating", syncCanvasState);
      }

      canvasRef.current = canvas;
      boundCanvasRef.current = canvas;

      if (canvas) {
        canvas.on("selection:created", syncCanvasState);
        canvas.on("selection:updated", syncCanvasState);
        canvas.on("selection:cleared", syncCanvasState);
        canvas.on("object:modified", syncCanvasState);
        canvas.on("object:moving", syncCanvasState);
        canvas.on("object:scaling", syncCanvasState);
        canvas.on("object:rotating", syncCanvasState);
      }

      syncCanvasState();
    },
    [syncCanvasState],
  );

  const addImage = useCallback(async (asset: ImageAsset) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const image = await FabricImage.fromURL(asset.objectUrl);
    const { canvasSize } = useEditorStore.getState();
    const scale = Math.min(
      (canvasSize.width * 0.58) / asset.width,
      (canvasSize.height * 0.7) / asset.height,
      1,
    );

    Object.assign(image, {
      objectId: createObjectId(),
      assetId: asset.id,
      role: canvas.getObjects().length === 0 ? "hero" : "support",
    });

    image.set({
      left: canvasSize.width / 2,
      top: canvasSize.height / 2,
      originX: "center",
      originY: "center",
      scaleX: scale,
      scaleY: scale,
      cornerStyle: "circle",
      cornerColor: "#ffffff",
      cornerStrokeColor: "#168cff",
      borderColor: "#62b1ff",
      transparentCorners: false,
      padding: 3,
    });

    canvas.add(image);
    canvas.setActiveObject(image);
    canvas.requestRenderAll();
    syncCanvasState();
  }, [syncCanvasState]);

  const removeAsset = useCallback(
    (assetId: string) => {
      const canvas = canvasRef.current;
      const asset = useEditorStore.getState().assets.find((item) => item.id === assetId);

      if (canvas) {
        const matchingObjects = canvas
          .getObjects()
          .filter((object) => (object as EditorFabricObject).assetId === assetId);
        canvas.remove(...matchingObjects);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }

      if (asset) {
        URL.revokeObjectURL(asset.objectUrl);
      }
      useEditorStore.getState().removeAsset(assetId);
      syncCanvasState();
    },
    [syncCanvasState],
  );

  const deleteSelection = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length === 0) {
      return;
    }

    canvas.discardActiveObject();
    canvas.remove(...activeObjects);
    canvas.requestRenderAll();
    syncCanvasState();
  }, [syncCanvasState]);

  const duplicateSelection = useCallback(async () => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject() as EditorFabricObject | undefined;
    if (!canvas || !activeObject) {
      return;
    }

    const clone = (await activeObject.clone([
      "assetId",
      "role",
    ])) as EditorFabricObject;
    clone.set({
      left: activeObject.left + 36,
      top: activeObject.top + 36,
    });
    clone.objectId = createObjectId();

    canvas.add(clone);
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
    syncCanvasState();
  }, [syncCanvasState]);

  const moveSelectionForward = useCallback(() => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();
    if (canvas && activeObject) {
      canvas.bringObjectForward(activeObject);
      canvas.requestRenderAll();
      syncCanvasState();
    }
  }, [syncCanvasState]);

  const moveSelectionBackward = useCallback(() => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();
    if (canvas && activeObject) {
      canvas.sendObjectBackwards(activeObject);
      canvas.requestRenderAll();
      syncCanvasState();
    }
  }, [syncCanvasState]);

  const nudgeSelection = useCallback(
    (x: number, y: number) => {
      const canvas = canvasRef.current;
      const activeObject = canvas?.getActiveObject();
      if (!canvas || !activeObject) {
        return;
      }

      activeObject.set({
        left: activeObject.left + x,
        top: activeObject.top + y,
      });
      activeObject.setCoords();
      canvas.requestRenderAll();
      syncCanvasState();
    },
    [syncCanvasState],
  );

  const clearSelection = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getActiveObject()) {
      return;
    }
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    syncCanvasState();
  }, [syncCanvasState]);

  const removeBackdrop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const backdrops = canvas
      .getObjects()
      .filter((object) => (object as EditorFabricObject).role === "background");
    if (backdrops.length === 0) {
      return;
    }

    canvas.remove(...backdrops);
    canvas.requestRenderAll();
    syncCanvasState();
    useEditorStore.getState().setNotice("Backdrop removed");
  }, [syncCanvasState]);

  const createBlurredBackdrop = useCallback(async () => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();
    if (!canvas || !(activeObject instanceof FabricImage)) {
      useEditorStore.getState().setNotice("Select an image to create a backdrop");
      return;
    }

    const source = activeObject as FabricImage & EditorFabricObject;
    if (source.role === "background") {
      return;
    }

    const existingBackdrops = canvas
      .getObjects()
      .filter((object) => (object as EditorFabricObject).role === "background");
    if (existingBackdrops.length > 0) {
      canvas.remove(...existingBackdrops);
    }

    const backdrop = (await source.clone([
      "assetId",
    ])) as FabricImage & EditorFabricObject;
    backdrop.objectId = createObjectId();
    backdrop.role = "background";
    backdrop.filters = [
      new filters.Blur({ blur: 0.16 }),
      new filters.Brightness({ brightness: -0.12 }),
      new filters.Saturation({ saturation: -0.18 }),
    ];
    backdrop.applyFilters();
    backdrop.set({
      angle: 0,
      opacity: 0.94,
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      shadow: null,
    });
    fitBackdropToCanvas(backdrop);

    canvas.add(backdrop);
    canvas.sendObjectToBack(backdrop);
    canvas.setActiveObject(source);
    canvas.requestRenderAll();
    syncCanvasState();
    useEditorStore.getState().setNotice("Soft blurred backdrop created");
  }, [fitBackdropToCanvas, syncCanvasState]);

  const exportPng = useCallback(async () => {
    const canvas = canvasRef.current;
    const state = useEditorStore.getState();
    if (!canvas || state.exportStatus === "exporting") {
      return;
    }

    state.setExportState("exporting", null);

    try {
      const blob = await renderCanvasPng(canvas, state.canvasSize);
      downloadPng(
        blob,
        `wallpaper-${state.canvasSize.width}x${state.canvasSize.height}.png`,
      );
      useEditorStore.getState().setExportState("success", null);
      useEditorStore
        .getState()
        .setNotice(`Exported ${state.canvasSize.width} × ${state.canvasSize.height} PNG`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed";
      useEditorStore.getState().setExportState("error", message);
      useEditorStore.getState().setNotice("Could not export this wallpaper");
    }
  }, []);

  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state, previousState) => {
      if (
        state.canvasSize.width === previousState.canvasSize.width &&
        state.canvasSize.height === previousState.canvasSize.height
      ) {
        return;
      }

      const canvas = canvasRef.current;
      const backdrop = canvas
        ?.getObjects()
        .find(
          (object) => (object as EditorFabricObject).role === "background",
        );
      if (backdrop instanceof FabricImage) {
        fitBackdropToCanvas(backdrop);
        canvas?.requestRenderAll();
      }
    });

    return unsubscribe;
  }, [fitBackdropToCanvas]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const commandKey = event.metaKey || event.ctrlKey;
      const step = event.shiftKey ? 10 : 1;

      if (event.key === "Tab") {
        const canToggleFocus =
          target === document.body ||
          target instanceof HTMLCanvasElement ||
          (target instanceof HTMLElement &&
            Boolean(target.closest(".canvas-stage, .stage-region")));
        if (canToggleFocus) {
          event.preventDefault();
          useEditorStore.getState().toggleFocusMode();
        }
        return;
      }

      if (event.key === "Escape") {
        clearSelection();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && !commandKey) {
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (commandKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void duplicateSelection();
        return;
      }

      if (commandKey && event.key === "]") {
        event.preventDefault();
        moveSelectionForward();
        return;
      }

      if (commandKey && event.key === "[") {
        event.preventDefault();
        moveSelectionBackward();
        return;
      }

      const movement = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }[event.key];

      if (movement) {
        event.preventDefault();
        nudgeSelection(movement[0], movement[1]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    clearSelection,
    deleteSelection,
    duplicateSelection,
    moveSelectionBackward,
    moveSelectionForward,
    nudgeSelection,
  ]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [notice, setNotice]);

  useEffect(() => {
    return () => {
      registerCanvas(null);
      const { assets, resetEditor } = useEditorStore.getState();
      assets.forEach((asset) => URL.revokeObjectURL(asset.objectUrl));
      resetEditor();
    };
  }, [registerCanvas]);

  const commands = useMemo<EditorCommands>(
    () => ({
      registerCanvas,
      addImage,
      removeAsset,
      deleteSelection,
      duplicateSelection,
      moveSelectionForward,
      moveSelectionBackward,
      nudgeSelection,
      clearSelection,
      createBlurredBackdrop,
      removeBackdrop,
      exportPng,
    }),
    [
      addImage,
      deleteSelection,
      duplicateSelection,
      exportPng,
      clearSelection,
      createBlurredBackdrop,
      moveSelectionBackward,
      moveSelectionForward,
      nudgeSelection,
      registerCanvas,
      removeBackdrop,
      removeAsset,
    ],
  );

  return (
    <EditorContext.Provider value={commands}>
      {children}
      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : null}
    </EditorContext.Provider>
  );
}

export function useEditorCommands() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditorCommands must be used within EditorProvider");
  }
  return context;
}
