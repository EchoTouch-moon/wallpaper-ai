import { Canvas } from "fabric";
import type { CanvasSize } from "@/types/canvas";

interface PreviewBounds {
  width: number;
  height: number;
}

export function initCanvas(element: HTMLCanvasElement) {
  return new Canvas(element, {
    backgroundColor: "#e8e5d9",
    preserveObjectStacking: true,
    selection: true,
  });
}

export function resizeCanvasPreview(
  canvas: Canvas,
  documentSize: CanvasSize,
  bounds: PreviewBounds,
) {
  const scale = Math.min(
    bounds.width / documentSize.width,
    bounds.height / documentSize.height,
    1,
  );

  canvas.setDimensions({
    width: Math.round(documentSize.width * scale),
    height: Math.round(documentSize.height * scale),
  });
  canvas.setViewportTransform([scale, 0, 0, scale, 0, 0]);
  canvas.requestRenderAll();

  return scale;
}
