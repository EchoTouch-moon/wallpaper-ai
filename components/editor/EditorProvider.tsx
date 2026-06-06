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
  type Canvas as FabricCanvas,
} from "fabric";
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
    });
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
    }),
    [
      addImage,
      deleteSelection,
      duplicateSelection,
      moveSelectionBackward,
      moveSelectionForward,
      registerCanvas,
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
