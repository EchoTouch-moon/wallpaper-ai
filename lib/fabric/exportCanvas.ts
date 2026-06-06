import type { Canvas } from "fabric";
import type { CanvasSize } from "@/types/canvas";

const IDENTITY_VIEWPORT: [number, number, number, number, number, number] = [
  1, 0, 0, 1, 0, 0,
];

export async function renderCanvasPng(canvas: Canvas, documentSize: CanvasSize) {
  const previewSize = {
    width: canvas.getWidth(),
    height: canvas.getHeight(),
  };
  const previewViewport = [...canvas.viewportTransform] as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const activeObject = canvas.getActiveObject();

  canvas.discardActiveObject();
  canvas.setDimensions(documentSize);
  canvas.setViewportTransform(IDENTITY_VIEWPORT);
  canvas.requestRenderAll();

  try {
    const blob = await canvas.toBlob({
      format: "png",
      multiplier: 1,
      enableRetinaScaling: false,
    });

    if (!blob) {
      throw new Error("The canvas could not be rendered");
    }

    return blob;
  } finally {
    canvas.setDimensions(previewSize);
    canvas.setViewportTransform(previewViewport);
    if (activeObject) {
      canvas.setActiveObject(activeObject);
    }
    canvas.requestRenderAll();
  }
}

export function downloadPng(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
