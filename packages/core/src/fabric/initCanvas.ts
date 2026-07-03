import { Canvas } from "fabric";
import type { CanvasSize } from "../types/canvas";

interface PreviewBounds {
  width: number;
  height: number;
}

export function initCanvas(element: HTMLCanvasElement) {
  return new Canvas(element, {
    backgroundColor: "#f4f3ed",
    preserveObjectStacking: true,
    selection: true,
    selectionColor: "rgba(22, 140, 255, 0.12)",
    selectionBorderColor: "#62b1ff",
    selectionLineWidth: 1,
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
