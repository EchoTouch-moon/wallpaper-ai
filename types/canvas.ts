import type { SafeArea } from "@/types/wallpaper";

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasObjectSnapshot {
  id: string;
  assetId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export interface WallpaperCanvas extends CanvasSize {
  id: string;
  ratio: string;
  backgroundColor: string;
  safeAreas: SafeArea[];
}

export interface CanvasItem {
  id: string;
  assetId: string;
  role: "hero" | "support" | "background";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity: number;
}
