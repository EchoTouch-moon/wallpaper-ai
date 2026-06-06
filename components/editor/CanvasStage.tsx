"use client";

import { useEffect, useRef } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { initCanvas, resizeCanvasPreview } from "@/lib/fabric/initCanvas";
import { useEditorStore } from "@/store/editorStore";

const STAGE_PADDING = 88;

export function CanvasStage() {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const isCanvasReady = useEditorStore((state) => state.isCanvasReady);
  const setCanvasReady = useEditorStore((state) => state.setCanvasReady);
  const setPreviewScale = useEditorStore((state) => state.setPreviewScale);

  useEffect(() => {
    const canvasElement = canvasElementRef.current;
    const viewport = viewportRef.current;

    if (!canvasElement || !viewport) {
      return;
    }

    const fabricCanvas = initCanvas(canvasElement);
    fabricRef.current = fabricCanvas;
    setCanvasReady(true);

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }

      const scale = resizeCanvasPreview(fabricCanvas, canvasSize, {
        width: Math.max(entry.contentRect.width - STAGE_PADDING, 240),
        height: Math.max(entry.contentRect.height - STAGE_PADDING, 180),
      });
      setPreviewScale(scale);
    });

    resizeObserver.observe(viewport);

    return () => {
      resizeObserver.disconnect();
      setCanvasReady(false);
      fabricRef.current = null;
      fabricCanvas.dispose();
    };
  }, [canvasSize, setCanvasReady, setPreviewScale]);

  return (
    <div className="canvas-stage" ref={viewportRef}>
      <div className="canvas-viewport" aria-label="Wallpaper canvas">
        <canvas ref={canvasElementRef} />
      </div>
      <div className="canvas-meta" aria-live="polite">
        <span>
          <i className={`status-dot ${isCanvasReady ? "ready" : ""}`} />
          {isCanvasReady ? "Fabric canvas ready" : "Initializing canvas"}
        </span>
        <span>
          {canvasSize.width} × {canvasSize.height}
        </span>
      </div>
    </div>
  );
}
