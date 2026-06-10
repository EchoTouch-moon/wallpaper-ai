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
  Rect,
  Shadow,
  type Canvas as FabricCanvas,
} from "fabric";
import {
  calculateCropFrame,
  calculateCropPan,
} from "@/lib/fabric/crop";
import { downloadPng, renderCanvasPng } from "@/lib/fabric/exportCanvas";
import { applyLayoutToCanvas, type LayoutFabricImage } from "@/lib/fabric/applyLayout";
import { serializeCanvasLayout } from "@/lib/fabric/serializeLayout";
import {
  createSnapSession,
  resetSnapSession,
  snapObjectToGeometry,
} from "@/lib/fabric/snapping";
import {
  deleteStoredAsset,
  loadProjectDraft,
  saveProjectDraft,
} from "@/lib/storage/projectDatabase";
import { createProjectSnapshot } from "@/lib/storage/projectSnapshot";
import { useEditorStore } from "@/store/editorStore";
import type { ImageAsset } from "@/types/asset";
import type {
  CanvasObjectSnapshot,
  CropAspectId,
} from "@/types/canvas";
import type { WallpaperItem, WallpaperLayout } from "@/types/layout";

interface EditorFabricObject extends FabricObject {
  objectId?: string;
  assetId?: string;
  role?: "hero" | "support" | "background";
  cropAspect?: CropAspectId;
  slotId?: string;
  layoutCrop?: WallpaperItem["crop"];
  layoutStyle?: WallpaperItem["style"];
  layoutMask?: WallpaperItem["mask"];
}

interface CropDragState {
  objectId: string;
  left: number;
  top: number;
}

interface ObjectMovingEvent {
  target: FabricObject;
  e?: any;
  transform?: {
    original: {
      left: number;
      top: number;
      cropX?: number;
      cropY?: number;
    };
  };
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
  applyCropPreset: (aspectId: CropAspectId) => void;
  finishCrop: () => void;
  resetCrop: () => void;
  applyLayout: (layout: WallpaperLayout, addToHistory?: boolean) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  exportPng: () => Promise<void>;
  updateSelectedObject: (properties: { opacity?: number; style?: Partial<WallpaperItem["style"]> }) => void;
  updateCanvasBackground: (color: string) => void;
}

const EditorContext = createContext<EditorCommands | null>(null);

FabricObject.customProperties = [
  "objectId",
  "assetId",
  "role",
  "cropAspect",
  "slotId",
  "layoutCrop",
  "layoutStyle",
  "layoutMask",
];

const CROP_ASPECTS: Record<Exclude<CropAspectId, "free">, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "3:4": 3 / 4,
  "9:16": 9 / 16,
};

function createObjectId() {
  return `object_${crypto.randomUUID()}`;
}

function readObjectSnapshot(object: EditorFabricObject): CanvasObjectSnapshot {
  const image = object instanceof FabricImage ? object : null;
  return {
    id: object.objectId ?? "",
    assetId: object.assetId,
    role: object.role,
    cropAspect: object.cropAspect,
    isCropped: image?.hasCrop() ?? false,
    x: Math.round(object.left),
    y: Math.round(object.top),
    width: Math.round(object.getScaledWidth()),
    height: Math.round(object.getScaledHeight()),
    rotation: Math.round(object.angle),
    opacity: Math.round(object.opacity * 100),
    style: object.layoutStyle,
  };
}

export function EditorProvider({ children }: Readonly<{ children: ReactNode }>) {
  const canvasRef = useRef<FabricCanvas | null>(null);
  const boundCanvasRef = useRef<FabricCanvas | null>(null);
  const cropDragRef = useRef<CropDragState | null>(null);
  const isApplyingLayoutRef = useRef(false);
  const snapSessionRef = useRef(createSnapSession());
  const pendingRestoreRef = useRef<WallpaperLayout | null>(null);
  const projectCreatedAtRef = useRef(new Date().toISOString());
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

  const renderLayoutOnCanvas = useCallback(
    async (layout: WallpaperLayout) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        pendingRestoreRef.current = layout;
        return false;
      }

      isApplyingLayoutRef.current = true;
      try {
        await applyLayoutToCanvas(
          canvas,
          layout,
          useEditorStore.getState().assets,
        );
        syncCanvasState();
        return true;
      } finally {
        isApplyingLayoutRef.current = false;
      }
    },
    [syncCanvasState],
  );

  const commitCurrentCanvasLayout = useCallback(() => {
    const canvas = canvasRef.current;
    const state = useEditorStore.getState();
    if (canvas && state.currentLayout && !isApplyingLayoutRef.current) {
      state.commitLayout(serializeCanvasLayout(canvas, state.currentLayout));
    }
  }, []);

  const finishCrop = useCallback(() => {
    const canvas = canvasRef.current;
    const cropDrag = cropDragRef.current;
    const cropObject = canvas
      ?.getObjects()
      .find(
        (object) =>
          (object as EditorFabricObject).objectId === cropDrag?.objectId,
      );

    if (cropObject) {
      cropObject.set({
        hasControls: true,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: false,
        borderColor: "#62b1ff",
        hoverCursor: "move",
      });
      cropObject.setCoords();
    }

    cropDragRef.current = null;
    useEditorStore.getState().setCropSession(null);
    useEditorStore.getState().setSnapGuides({
      vertical: [],
      horizontal: [],
    });
    resetSnapSession(snapSessionRef.current);
    canvas?.requestRenderAll();
    syncCanvasState();
    commitCurrentCanvasLayout();
  }, [commitCurrentCanvasLayout, syncCanvasState]);

  const handleSelectionChange = useCallback(() => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject() as EditorFabricObject | undefined;
    const cropDrag = cropDragRef.current;
    if (cropDrag && activeObject?.objectId !== cropDrag.objectId) {
      finishCrop();
      return;
    }
    useEditorStore.getState().setSnapGuides({
      vertical: [],
      horizontal: [],
    });
    syncCanvasState();
  }, [finishCrop, syncCanvasState]);

  const handleObjectMoving = useCallback(
    (event: ObjectMovingEvent) => {
      const canvas = canvasRef.current;
      const target = event.target as EditorFabricObject;
      if (!canvas) {
        return;
      }

      const cropDrag = cropDragRef.current;
      if (
        cropDrag &&
        cropDrag.objectId === target.objectId &&
        target instanceof FabricImage
      ) {
        const dragOrigin = event.transform?.original;
        const fixedLeft = dragOrigin?.left ?? cropDrag.left;
        const fixedTop = dragOrigin?.top ?? cropDrag.top;
        const initialCropX = dragOrigin?.cropX ?? target.cropX;
        const initialCropY = dragOrigin?.cropY ?? target.cropY;
        const deltaX = target.left - fixedLeft;
        const deltaY = target.top - fixedTop;
        const original = target.getOriginalSize();
        const crop = calculateCropPan({
          initialCropX,
          initialCropY,
          deltaX,
          deltaY,
          angle: target.angle,
          scaleX: target.scaleX,
          scaleY: target.scaleY,
          original,
          frame: target,
        });

        target.set({
          left: fixedLeft,
          top: fixedTop,
          cropX: crop.cropX,
          cropY: crop.cropY,
          dirty: true,
        });
        target.setCoords();
        useEditorStore.getState().setSnapGuides({
          vertical: [],
          horizontal: [],
        });
        resetSnapSession(snapSessionRef.current);
      } else {
        const { canvasSize, enableSnapping } = useEditorStore.getState();
        const hasBypassKey = event.e && (event.e.metaKey || event.e.ctrlKey);

        if (enableSnapping && !hasBypassKey) {
          useEditorStore
            .getState()
            .setSnapGuides(
              snapObjectToGeometry(
                canvas,
                target,
                canvasSize.width,
                canvasSize.height,
                snapSessionRef.current,
              ),
            );
        } else {
          useEditorStore.getState().setSnapGuides({
            vertical: [],
            horizontal: [],
          });
          resetSnapSession(snapSessionRef.current);
        }
      }

      canvas.requestRenderAll();
      syncCanvasState();
    },
    [syncCanvasState],
  );

  const handleObjectModified = useCallback(() => {
    resetSnapSession(snapSessionRef.current);
    useEditorStore.getState().setSnapGuides({
      vertical: [],
      horizontal: [],
    });
    syncCanvasState();
    commitCurrentCanvasLayout();
  }, [commitCurrentCanvasLayout, syncCanvasState]);

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
        boundCanvasRef.current.off("selection:created", handleSelectionChange);
        boundCanvasRef.current.off("selection:updated", handleSelectionChange);
        boundCanvasRef.current.off("selection:cleared", handleSelectionChange);
        boundCanvasRef.current.off("object:modified", handleObjectModified);
        boundCanvasRef.current.off("object:moving", handleObjectMoving);
        boundCanvasRef.current.off("object:scaling", syncCanvasState);
        boundCanvasRef.current.off("object:rotating", syncCanvasState);
      }

      canvasRef.current = canvas;
      boundCanvasRef.current = canvas;

      if (canvas) {
        canvas.on("selection:created", handleSelectionChange);
        canvas.on("selection:updated", handleSelectionChange);
        canvas.on("selection:cleared", handleSelectionChange);
        canvas.on("object:modified", handleObjectModified);
        canvas.on("object:moving", handleObjectMoving);
        canvas.on("object:scaling", syncCanvasState);
        canvas.on("object:rotating", syncCanvasState);
      } else {
        resetSnapSession(snapSessionRef.current);
      }

      syncCanvasState();

      const pendingLayout = pendingRestoreRef.current;
      if (canvas && pendingLayout) {
        pendingRestoreRef.current = null;
        void renderLayoutOnCanvas(pendingLayout).catch(() => {
          setNotice("Could not restore the saved canvas");
        });
      }
    },
    [
      handleObjectModified,
      handleObjectMoving,
      handleSelectionChange,
      renderLayoutOnCanvas,
      setNotice,
      syncCanvasState,
    ],
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
    commitCurrentCanvasLayout();
  }, [commitCurrentCanvasLayout, syncCanvasState]);

  const removeAsset = useCallback(
    (assetId: string) => {
      const canvas = canvasRef.current;
      const asset = useEditorStore.getState().assets.find((item) => item.id === assetId);
      const cropObjectId = cropDragRef.current?.objectId;

      if (canvas) {
        const matchingObjects = canvas
          .getObjects()
          .filter((object) => (object as EditorFabricObject).assetId === assetId);
        if (
          cropObjectId &&
          matchingObjects.some(
            (object) => (object as EditorFabricObject).objectId === cropObjectId,
          )
        ) {
          finishCrop();
        }
        canvas.remove(...matchingObjects);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }

      if (asset) {
        URL.revokeObjectURL(asset.objectUrl);
      }

      void deleteStoredAsset(assetId).catch(() => {
        useEditorStore.getState().setNotice("Could not update local storage");
      });
      useEditorStore.getState().removeAsset(assetId);
      syncCanvasState();
      commitCurrentCanvasLayout();
    },
    [commitCurrentCanvasLayout, finishCrop, syncCanvasState],
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

    if (
      cropDragRef.current &&
      activeObjects.some(
        (object) =>
          (object as EditorFabricObject).objectId === cropDragRef.current?.objectId,
      )
    ) {
      finishCrop();
    }
    canvas.discardActiveObject();
    canvas.remove(...activeObjects);
    canvas.requestRenderAll();
    syncCanvasState();
    commitCurrentCanvasLayout();
  }, [commitCurrentCanvasLayout, finishCrop, syncCanvasState]);

  const duplicateSelection = useCallback(async () => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject() as EditorFabricObject | undefined;
    if (!canvas || !activeObject) {
      return;
    }

    const clone = (await activeObject.clone([
      "assetId",
      "role",
      "cropAspect",
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
    commitCurrentCanvasLayout();
  }, [commitCurrentCanvasLayout, syncCanvasState]);

  const moveSelectionForward = useCallback(() => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();
    if (canvas && activeObject) {
      canvas.bringObjectForward(activeObject);
      canvas.requestRenderAll();
      syncCanvasState();
      commitCurrentCanvasLayout();
    }
  }, [commitCurrentCanvasLayout, syncCanvasState]);

  const moveSelectionBackward = useCallback(() => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();
    if (canvas && activeObject) {
      canvas.sendObjectBackwards(activeObject);
      canvas.requestRenderAll();
      syncCanvasState();
      commitCurrentCanvasLayout();
    }
  }, [commitCurrentCanvasLayout, syncCanvasState]);

  const nudgeSelection = useCallback(
    (x: number, y: number) => {
      const canvas = canvasRef.current;
      const activeObject = canvas?.getActiveObject();
      if (!canvas || !activeObject) {
        return;
      }

      if (
        cropDragRef.current &&
        (activeObject as EditorFabricObject).objectId ===
          cropDragRef.current.objectId &&
        activeObject instanceof FabricImage
      ) {
        const original = activeObject.getOriginalSize();
        activeObject.set({
          cropX: Math.min(
            Math.max(
              activeObject.cropX +
                x / Math.max(Math.abs(activeObject.scaleX), 0.001),
              0,
            ),
            Math.max(original.width - activeObject.width, 0),
          ),
          cropY: Math.min(
            Math.max(
              activeObject.cropY +
                y / Math.max(Math.abs(activeObject.scaleY), 0.001),
              0,
            ),
            Math.max(original.height - activeObject.height, 0),
          ),
          dirty: true,
        });
        canvas.requestRenderAll();
        syncCanvasState();
        commitCurrentCanvasLayout();
        return;
      }

      activeObject.set({
        left: activeObject.left + x,
        top: activeObject.top + y,
      });
      activeObject.setCoords();
      canvas.requestRenderAll();
      syncCanvasState();
      commitCurrentCanvasLayout();
    },
    [commitCurrentCanvasLayout, syncCanvasState],
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

  const applyCropPreset = useCallback(
    (aspectId: CropAspectId) => {
      const canvas = canvasRef.current;
      const activeObject = canvas?.getActiveObject();
      if (!canvas || !(activeObject instanceof FabricImage)) {
        useEditorStore.getState().setNotice("Select an image before cropping");
        return;
      }

      const image = activeObject as FabricImage & EditorFabricObject;
      if (image.role === "background" || !image.objectId) {
        return;
      }

      if (aspectId === "free") {
        finishCrop();
        return;
      }

      const original = image.getOriginalSize();
      const aspect = CROP_ASPECTS[aspectId];
      const crop = calculateCropFrame(
        original,
        aspect,
        {
          width: image.getScaledWidth(),
          height: image.getScaledHeight(),
        },
      );

      image.cropAspect = aspectId;
      image.set({
        width: crop.width,
        height: crop.height,
        cropX: crop.cropX,
        cropY: crop.cropY,
        scaleX: crop.scale,
        scaleY: crop.scale,
        hasControls: false,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        borderColor: "#ff9d47",
        hoverCursor: "grab",
        dirty: true,
      });
      image.setCoords();
      cropDragRef.current = {
        objectId: image.objectId,
        left: image.left,
        top: image.top,
      };
      useEditorStore.getState().setCropSession({
        objectId: image.objectId,
        aspectId,
      });
      useEditorStore.getState().setNotice("Drag the photo to adjust the crop");
      canvas.requestRenderAll();
      syncCanvasState();
    },
    [finishCrop, syncCanvasState],
  );

  const resetCrop = useCallback(() => {
    const canvas = canvasRef.current;
    const activeObject = canvas?.getActiveObject();
    if (!canvas || !(activeObject instanceof FabricImage)) {
      return;
    }

    const image = activeObject as FabricImage & EditorFabricObject;
    const original = image.getOriginalSize();
    const currentDisplayWidth = image.getScaledWidth();
    const currentDisplayHeight = image.getScaledHeight();
    const scale = Math.sqrt(
      (currentDisplayWidth * currentDisplayHeight) /
        Math.max(original.width * original.height, 1),
    );

    finishCrop();
    image.cropAspect = undefined;
    image.set({
      width: original.width,
      height: original.height,
      cropX: 0,
      cropY: 0,
      scaleX: scale,
      scaleY: scale,
      dirty: true,
    });
    image.setCoords();
    canvas.requestRenderAll();
    syncCanvasState();
    useEditorStore.getState().setNotice("Crop reset");
    commitCurrentCanvasLayout();
  }, [commitCurrentCanvasLayout, finishCrop, syncCanvasState]);

  const applyLayout = useCallback(
    async (layout: WallpaperLayout, addToHistory = true) => {
      const rendered = await renderLayoutOnCanvas(layout).catch(() => false);
      if (!rendered) {
        if (!canvasRef.current) {
          useEditorStore.getState().setNotice("Canvas is still loading");
        } else {
          useEditorStore.getState().setNotice("Could not apply this layout");
        }
        return;
      }

      useEditorStore.getState().commitLayout(layout, addToHistory);
      useEditorStore
        .getState()
        .setNotice(`${layout.template?.id ?? "Layout"} applied`);
    },
    [renderLayoutOnCanvas],
  );

  const undo = useCallback(async () => {
    const layout = useEditorStore.getState().undoLayout();
    if (layout === null) {
      const canvas = canvasRef.current;
      if (canvas) {
        isApplyingLayoutRef.current = true;
        canvas.discardActiveObject();
        canvas.remove(...canvas.getObjects());
        canvas.requestRenderAll();
        syncCanvasState();
        isApplyingLayoutRef.current = false;
      }
    } else if (layout) {
      await applyLayout(layout, false);
    }
  }, [applyLayout, syncCanvasState]);

  const redo = useCallback(async () => {
    const layout = useEditorStore.getState().redoLayout();
    if (layout === null) {
      const canvas = canvasRef.current;
      if (canvas) {
        isApplyingLayoutRef.current = true;
        canvas.discardActiveObject();
        canvas.remove(...canvas.getObjects());
        canvas.requestRenderAll();
        syncCanvasState();
        isApplyingLayoutRef.current = false;
      }
    } else if (layout) {
      await applyLayout(layout, false);
    }
  }, [applyLayout, syncCanvasState]);

  const updateSelectedObject = useCallback(
    (properties: { opacity?: number; style?: Partial<NonNullable<WallpaperItem["style"]>> }) => {
      const canvas = canvasRef.current;
      const activeObject = canvas?.getActiveObject();
      if (!canvas || !(activeObject instanceof FabricImage)) {
        return;
      }

      const image = activeObject as LayoutFabricImage;

      if (properties.opacity !== undefined) {
        image.set({ opacity: properties.opacity });
      }

      if (properties.style !== undefined) {
        const nextStyle = { ...image.layoutStyle, ...properties.style };
        image.layoutStyle = nextStyle;

        // Apply radius changes
        if (properties.style.radius !== undefined) {
          if (properties.style.radius > 0) {
            const scale = Math.max(Math.abs(image.scaleX), 0.001);
            image.clipPath = new Rect({
              width: image.width,
              height: image.height,
              rx: properties.style.radius / scale,
              ry: properties.style.radius / scale,
              originX: "center",
              originY: "center",
            });
          } else {
            image.clipPath = undefined;
          }
        }

        // Apply shadow changes
        if (properties.style.shadow !== undefined) {
          if (properties.style.shadow !== "none") {
            image.shadow = new Shadow({
              color:
                properties.style.shadow === "strong"
                  ? "rgba(24, 34, 50, 0.34)"
                  : "rgba(24, 34, 50, 0.2)",
              blur: properties.style.shadow === "strong" ? 36 : 22,
              offsetX: 0,
              offsetY: properties.style.shadow === "strong" ? 18 : 10,
            });
          } else {
            image.shadow = null;
          }
        }

        // Apply border changes
        if (properties.style.border !== undefined) {
          image.set({
            stroke: properties.style.border.color,
            strokeWidth: properties.style.border.width ?? 0,
          });
        }
      }

      image.set({ dirty: true });
      canvas.requestRenderAll();
      syncCanvasState();
      commitCurrentCanvasLayout();
    },
    [syncCanvasState, commitCurrentCanvasLayout],
  );

  const updateCanvasBackground = useCallback(
    (color: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.backgroundColor = color;
      canvas.requestRenderAll();
      syncCanvasState();
      commitCurrentCanvasLayout();
    },
    [syncCanvasState, commitCurrentCanvasLayout],
  );

  useEffect(() => {
    let isCancelled = false;

    void loadProjectDraft()
      .then(async (restored) => {
        if (isCancelled) {
          restored?.assets.forEach((asset) =>
            URL.revokeObjectURL(asset.objectUrl),
          );
          return;
        }

        if (!restored) {
          useEditorStore.getState().markProjectHydrated();
          return;
        }

        projectCreatedAtRef.current = restored.project.createdAt;
        useEditorStore
          .getState()
          .hydrateProject(restored.assets, restored.project);

        if (restored.project.currentLayout) {
          await renderLayoutOnCanvas(restored.project.currentLayout);
        }

        useEditorStore.getState().setNotice("Local draft restored");
      })
      .catch(() => {
        if (!isCancelled) {
          useEditorStore.getState().markProjectHydrated();
          useEditorStore
            .getState()
            .setNotice("Local draft storage is unavailable");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [renderLayoutOnCanvas]);

  useEffect(() => {
    let timeout: number | undefined;
    const unsubscribe = useEditorStore.subscribe((state, previousState) => {
      if (!state.isProjectHydrated) {
        return;
      }

      if (
        state.ratioId === previousState.ratioId &&
        state.assets === previousState.assets &&
        state.candidates === previousState.candidates &&
        state.currentLayout === previousState.currentLayout
      ) {
        return;
      }

      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        const latest = useEditorStore.getState();
        try {
          const snapshot = createProjectSnapshot({
            createdAt: projectCreatedAtRef.current,
            assets: latest.assets,
            candidates: latest.candidates,
            currentLayout: latest.currentLayout,
            ratioId: latest.ratioId,
          });

          void saveProjectDraft(snapshot).catch(() => {
            useEditorStore
              .getState()
              .setNotice("Could not save the local draft");
          });
        } catch {
          useEditorStore
            .getState()
            .setNotice("The current draft could not be validated");
        }
      }, 800);
    });

    return () => {
      unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

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
        if (cropDragRef.current) {
          finishCrop();
        } else {
          clearSelection();
        }
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

      if (commandKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          void redo();
        } else {
          void undo();
        }
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
    finishCrop,
    moveSelectionBackward,
    moveSelectionForward,
    nudgeSelection,
    redo,
    undo,
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
      applyCropPreset,
      finishCrop,
      resetCrop,
      applyLayout,
      undo,
      redo,
      exportPng,
      updateSelectedObject,
      updateCanvasBackground,
    }),
    [
      addImage,
      applyCropPreset,
      applyLayout,
      deleteSelection,
      duplicateSelection,
      exportPng,
      finishCrop,
      clearSelection,
      createBlurredBackdrop,
      moveSelectionBackward,
      moveSelectionForward,
      nudgeSelection,
      registerCanvas,
      resetCrop,
      redo,
      removeBackdrop,
      removeAsset,
      undo,
      updateSelectedObject,
      updateCanvasBackground,
    ],
  );

  return (
    <EditorContext.Provider value={commands}>
      {children}
      {notice ? (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 max-w-[min(90vw,460px)] px-4 py-2.5 bg-black text-white text-xs font-medium rounded-full shadow-lg" role="status">
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
