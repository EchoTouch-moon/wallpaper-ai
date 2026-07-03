import type { SafeArea } from "./wallpaper";
import type { WallpaperItem } from "./layout";

export interface CanvasSize {
  width: number;
  height: number;
}

export type CropAspectId = "free" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";

export interface SnapGuides {
  vertical: number[];
  horizontal: number[];
}

export interface CropSession {
  objectId: string;
  aspectId: CropAspectId;
}

export interface CanvasObjectSnapshot {
  id: string;
  assetId?: string;
  role?: "hero" | "support" | "background";
  cropAspect?: CropAspectId;
  isCropped: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  style?: WallpaperItem["style"];
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
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
