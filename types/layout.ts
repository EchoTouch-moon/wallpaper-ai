import type { CanvasItem, WallpaperCanvas } from "@/types/canvas";

export interface WallpaperLayout {
  version: "1.0";
  canvas: WallpaperCanvas;
  items: CanvasItem[];
  notes: string[];
}
