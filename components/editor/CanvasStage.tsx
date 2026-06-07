"use client";

import { useEffect, useRef } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { initCanvas, resizeCanvasPreview } from "@/lib/fabric/initCanvas";
import { useEditorStore } from "@/store/editorStore";

const STAGE_PADDING = 40;

export function CanvasStage() {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const { registerCanvas } = useEditorCommands();
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const isCanvasReady = useEditorStore((state) => state.isCanvasReady);
  const setCanvasReady = useEditorStore((state) => state.setCanvasReady);
  const setPreviewScale = useEditorStore((state) => state.setPreviewScale);
  const snapGuides = useEditorStore((state) => state.snapGuides);
  const cropSession = useEditorStore((state) => state.cropSession);

  useEffect(() => {
    const canvasElement = canvasElementRef.current;

    if (!canvasElement) {
      return;
    }

    const fabricCanvas = initCanvas(canvasElement);
    fabricRef.current = fabricCanvas;
    registerCanvas(fabricCanvas);
    setCanvasReady(true);

    return () => {
      registerCanvas(null);
      setCanvasReady(false);
      fabricRef.current = null;
      fabricCanvas.dispose();
    };
  }, [registerCanvas, setCanvasReady]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const fabricCanvas = fabricRef.current;

    if (!viewport || !fabricCanvas) {
      return;
    }

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
    };
  }, [canvasSize, setPreviewScale]);

  return (
    <div className="canvas-stage" ref={viewportRef}>
      <div className="canvas-viewport" aria-label="Wallpaper canvas">
        <canvas ref={canvasElementRef} />
        <div className="snap-guide-layer" aria-hidden="true">
          {snapGuides.vertical.map((position) => (
            <i
              className="snap-guide vertical"
              key={`vertical-${position}`}
              style={{ left: `${(position / canvasSize.width) * 100}%` }}
            />
          ))}
          {snapGuides.horizontal.map((position) => (
            <i
              className="snap-guide horizontal"
              key={`horizontal-${position}`}
              style={{ top: `${(position / canvasSize.height) * 100}%` }}
            />
          ))}
        </div>
      </div>
      {cropSession ? (
        <div className="crop-mode-badge" role="status">
          Crop mode · drag photo to reframe · Esc to finish
        </div>
      ) : null}
      <div className="canvas-meta" aria-live="polite">
        <span>
          <i className={`status-dot ${isCanvasReady ? "ready" : ""}`} />
          {isCanvasReady ? "Fabric canvas ready" : "Initializing canvas"}
        </span>
        <span>
          {canvasSize.width} × {canvasSize.height}
        </span>
      </div>
      <div className="shortcut-hint" aria-label="Keyboard shortcuts">
        <span>
          <kbd>Tab</kbd> Focus
        </span>
        <span>
          <kbd>⌘D</kbd> Duplicate
        </span>
        <span>
          <kbd>↑↓←→</kbd> Nudge
        </span>
        <span>
          <kbd>⌫</kbd> Delete
        </span>
      </div>
    </div>
  );
}
