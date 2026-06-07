import type {
  CompositionIntent,
  ImageTransition,
  LayoutGuidance,
} from "@/types/layout";

export interface CompositionPreset {
  id: CompositionIntent;
  label: string;
  description: string;
  bestFor: string;
  guidance: Omit<LayoutGuidance, "focalAssetId">;
}

const SOFT_GRADIENT: ImageTransition = {
  type: "soft-gradient",
  strength: 0.72,
  feather: 96,
};

export const COMPOSITION_PRESETS: CompositionPreset[] = [
  {
    id: "single-hero",
    label: "Full-bleed hero",
    description: "One image leads; its colors extend into quiet wallpaper space.",
    bestFor: "One strong landscape image or one portrait with a clean background",
    guidance: {
      intent: "single-hero",
      visualFlow: "center-out",
      boundary: {
        type: "edge-to-edge",
        gap: 0,
        radius: 0,
        width: 0,
      },
      transition: {
        type: "blurred-extension",
        strength: 0.78,
        feather: 140,
      },
      preserveFaces: true,
      preserveNegativeSpace: true,
    },
  },
  {
    id: "hero-with-support",
    label: "Hero and supporting moments",
    description: "A dominant image anchors two or three quieter supporting frames.",
    bestFor: "Mixed landscape and portrait photos",
    guidance: {
      intent: "hero-with-support",
      visualFlow: "left-to-right",
      boundary: {
        type: "soft-shadow",
        gap: 36,
        radius: 28,
        width: 0,
      },
      transition: SOFT_GRADIENT,
      preserveFaces: true,
      preserveNegativeSpace: true,
    },
  },
  {
    id: "balanced-collage",
    label: "Balanced collage",
    description: "Similar-weight images share a rhythm without hard seams.",
    bestFor: "Three to six photos with related color and lighting",
    guidance: {
      intent: "balanced-collage",
      visualFlow: "center-out",
      boundary: {
        type: "clean-gap",
        gap: 28,
        radius: 18,
        width: 0,
      },
      transition: {
        type: "shared-color-wash",
        strength: 0.58,
        feather: 64,
      },
      preserveFaces: true,
      preserveNegativeSpace: false,
    },
  },
  {
    id: "story-strip",
    label: "Cinematic story strip",
    description: "A sequence of images reads like a calm timeline across the screen.",
    bestFor: "Several images with the same orientation",
    guidance: {
      intent: "story-strip",
      visualFlow: "left-to-right",
      boundary: {
        type: "hairline",
        gap: 18,
        radius: 12,
        width: 2,
        color: "#f4f3ed",
      },
      transition: {
        type: "clean-gap",
        strength: 0.35,
        feather: 24,
      },
      preserveFaces: true,
      preserveNegativeSpace: true,
    },
  },
];
