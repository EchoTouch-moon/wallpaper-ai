"use client";

import { useEffect, useRef } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { initCanvas, resizeCanvasPreview } from "@/lib/fabric/initCanvas";
import { SAFE_AREA_LABELS } from "@/lib/wallpaper/safeAreas";
import { useEditorStore } from "@/store/editorStore";
import { createSafeAreas } from "@/lib/wallpaper/layoutSafeAreas";

const STAGE_PADDING = 48; // Reduced padding for docked sidebars

export function CanvasStage() {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const { registerCanvas } = useEditorCommands();
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const setCanvasReady = useEditorStore((state) => state.setCanvasReady);
  const setPreviewScale = useEditorStore((state) => state.setPreviewScale);
  const snapGuides = useEditorStore((state) => state.snapGuides);
  const cropSession = useEditorStore((state) => state.cropSession);
  const currentLayout = useEditorStore((state) => state.currentLayout);
  const ratioId = useEditorStore((state) => state.ratioId);
  const showSafeAreas = useEditorStore((state) => state.showSafeAreas);
  const safeAreas =
    currentLayout?.safeAreas ??
    createSafeAreas(ratioId, canvasSize.width, canvasSize.height);

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
        width: Math.max(entry.contentRect.width - STAGE_PADDING * 2, 240),
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
    <div className="canvas-stage absolute inset-0 flex flex-col items-center justify-center pointer-events-auto" ref={viewportRef}>
      
      {/* Center dot pattern background */}
      <div className="canvas-stage-grid absolute inset-0 pointer-events-none" />

      <div className="canvas-paper relative max-w-full max-h-full grid place-items-center rounded-sm" aria-label="Wallpaper canvas">
        <canvas ref={canvasElementRef} className="block" />
        
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-10" aria-hidden="true">
          {snapGuides.vertical.map((position) => (
            <i
              className="absolute block w-px top-0 bottom-0 bg-[#0068de] shadow-[0_0_0_1px_rgba(255,255,255,0.8)]"
              key={`vertical-${position}`}
              style={{ left: `${(position / canvasSize.width) * 100}%` }}
            />
          ))}
          {snapGuides.horizontal.map((position) => (
            <i
              className="absolute block h-px left-0 right-0 bg-[#0068de] shadow-[0_0_0_1px_rgba(255,255,255,0.8)]"
              key={`horizontal-${position}`}
              style={{ top: `${(position / canvasSize.height) * 100}%` }}
            />
          ))}
        </div>

        {showSafeAreas ? (
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-10" aria-hidden="true">
            {safeAreas.map((area) => (
              <i
                className="absolute block border border-dashed border-black/20 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.02)0,rgba(0,0,0,0.02)5px,transparent_5px,transparent_10px)]"
                key={area.id}
                style={{
                  left: `${(area.x / canvasSize.width) * 100}%`,
                  top: `${(area.y / canvasSize.height) * 100}%`,
                  width: `${(area.width / canvasSize.width) * 100}%`,
                  height: `${(area.height / canvasSize.height) * 100}%`,
                }}
              >
                <span className="absolute top-1 left-1.5 px-1.5 py-0.5 rounded bg-white/90 text-gray-700 font-mono text-[8px] uppercase font-semibold">
                  {SAFE_AREA_LABELS[area.type]}
                </span>
              </i>
            ))}
          </div>
        ) : null}
      </div>

      {cropSession ? (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 border border-gray-200 rounded-full px-4 py-2 bg-white text-black shadow-sm font-medium text-[11px]" role="status">
          裁剪模式 · 拖拽图片以重新定位 · 按 Esc 键完成
        </div>
      ) : null}

      <div className="absolute bottom-4 left-4 flex gap-3 text-gray-400 text-[10px] z-0" aria-label="快捷键">
        <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 border border-gray-200 rounded text-gray-600 bg-white font-mono text-[9px] shadow-sm">Tab</kbd> 切换聚焦</span>
        <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 border border-gray-200 rounded text-gray-600 bg-white font-mono text-[9px] shadow-sm">⌘D</kbd> 复制</span>
        <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 border border-gray-200 rounded text-gray-600 bg-white font-mono text-[9px] shadow-sm">↑↓←→</kbd> 微调</span>
        <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 border border-gray-200 rounded text-gray-600 bg-white font-mono text-[9px] shadow-sm">⌫</kbd> 删除</span>
      </div>
    </div>
  );
}
