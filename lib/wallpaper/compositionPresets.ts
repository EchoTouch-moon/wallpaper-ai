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
    label: "单图焦点壁纸",
    description: "以一张核心大图为主，色彩自然延展入静谧的壁纸空间。",
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
    label: "主图配图排版",
    description: "一张主导影像为主，两三张辅助照片环绕，讲求留白与节奏。",
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
    label: "平衡拼图排版",
    description: "多张照片平分秋色，共享一致的视觉韵律与过渡处理。",
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
    label: "电影故事胶片",
    description: "照片如同电影胶片般横向铺展，仿佛在屏幕上徐徐讲述一段回忆。",
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
