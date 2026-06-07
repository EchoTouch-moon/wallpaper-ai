import type { CanvasItem, WallpaperCanvas } from "@/types/canvas";

export type CompositionIntent =
  | "single-hero"
  | "hero-with-support"
  | "balanced-collage"
  | "story-strip";

export type ImageTransitionType =
  | "soft-gradient"
  | "blurred-extension"
  | "overlap-shadow"
  | "shared-color-wash"
  | "clean-gap";

export type BoundaryTreatmentType =
  | "edge-to-edge"
  | "clean-gap"
  | "hairline"
  | "soft-shadow"
  | "overlap"
  | "feather"
  | "paper-edge";

export interface ImageTransition {
  type: ImageTransitionType;
  strength: number;
  feather: number;
  color?: string;
}

export interface BoundaryTreatment {
  type: BoundaryTreatmentType;
  gap: number;
  radius: number;
  width: number;
  color?: string;
}

export interface LayoutGuidance {
  intent: CompositionIntent;
  focalAssetId?: string;
  visualFlow: "left-to-right" | "right-to-left" | "top-to-bottom" | "center-out";
  transition: ImageTransition;
  boundary: BoundaryTreatment;
  preserveFaces: boolean;
  preserveNegativeSpace: boolean;
}

export interface WallpaperLayout {
  version: "1.0";
  canvas: WallpaperCanvas;
  items: CanvasItem[];
  guidance: LayoutGuidance;
  notes: string[];
}
