import { wallpaperTemplateSchema } from "./layoutSchema.ts";
import type { WallpaperTemplate } from "@/types/layout";

const DESKTOP_RATIOS = ["16:9", "16:10", "21:9"];
const MOBILE_RATIOS = ["9:16", "9:19.5"];

const rawTemplates: WallpaperTemplate[] = [
  {
    id: "triptych_desktop_equal",
    name: "Minimal Equal Triptych",
    type: "triptych",
    supportedRatios: DESKTOP_RATIOS,
    minImages: 3,
    maxImages: 3,
    slots: [
      { id: "left", x: 0.018, y: 0.032, width: 0.309, height: 0.936, rotation: 0, zIndex: 1, role: "support", shape: "rect" },
      { id: "center", x: 0.345, y: 0.032, width: 0.31, height: 0.936, rotation: 0, zIndex: 2, role: "hero", shape: "rect" },
      { id: "right", x: 0.673, y: 0.032, width: 0.309, height: 0.936, rotation: 0, zIndex: 1, role: "support", shape: "rect" },
    ],
  },
  {
    id: "triptych_desktop_editorial",
    name: "Editorial Hero + Two",
    type: "triptych",
    supportedRatios: DESKTOP_RATIOS,
    minImages: 3,
    maxImages: 3,
    slots: [
      { id: "hero", x: 0.025, y: 0.045, width: 0.62, height: 0.91, rotation: 0, zIndex: 2, role: "hero", shape: "rounded-rect", radius: 0.025 },
      { id: "support_top", x: 0.675, y: 0.045, width: 0.3, height: 0.435, rotation: 0, zIndex: 1, role: "support", shape: "rounded-rect", radius: 0.025 },
      { id: "support_bottom", x: 0.675, y: 0.52, width: 0.3, height: 0.435, rotation: 0, zIndex: 1, role: "support", shape: "rounded-rect", radius: 0.025 },
    ],
  },
  {
    id: "triptych_desktop_cinematic",
    name: "Cinematic Edge-to-Edge",
    type: "triptych",
    supportedRatios: DESKTOP_RATIOS,
    minImages: 3,
    maxImages: 3,
    slots: [
      { id: "left", x: 0, y: 0, width: 0.333, height: 1, rotation: 0, zIndex: 1, role: "support", shape: "rect" },
      { id: "center", x: 0.333, y: 0, width: 0.334, height: 1, rotation: 0, zIndex: 2, role: "hero", shape: "rect" },
      { id: "right", x: 0.667, y: 0, width: 0.333, height: 1, rotation: 0, zIndex: 1, role: "support", shape: "rect" },
    ],
  },
  {
    id: "layered_moodboard_desktop",
    name: "Layered Moodboard",
    type: "layered-moodboard",
    supportedRatios: DESKTOP_RATIOS,
    minImages: 3,
    maxImages: 5,
    slots: [
      { id: "background", x: 0, y: 0, width: 1, height: 1, rotation: 0, zIndex: 0, role: "background", shape: "rect" },
      { id: "hero", x: 0.08, y: 0.11, width: 0.54, height: 0.74, rotation: -2, zIndex: 3, role: "hero", shape: "rounded-rect", radius: 0.026 },
      { id: "support_top", x: 0.58, y: 0.13, width: 0.34, height: 0.31, rotation: 3, zIndex: 2, role: "support", shape: "rounded-rect", radius: 0.024 },
      { id: "support_bottom", x: 0.63, y: 0.49, width: 0.29, height: 0.35, rotation: -3, zIndex: 2, role: "support", shape: "rounded-rect", radius: 0.024 },
    ],
  },
  {
    id: "irregular_collage_desktop",
    name: "Irregular Gallery Collage",
    type: "irregular-collage",
    supportedRatios: DESKTOP_RATIOS,
    minImages: 3,
    maxImages: 5,
    slots: [
      { id: "hero", x: 0.08, y: 0.08, width: 0.43, height: 0.84, rotation: -1, zIndex: 2, role: "hero", shape: "rounded-rect", radius: 0.024 },
      { id: "support_top", x: 0.48, y: 0.1, width: 0.34, height: 0.34, rotation: 2, zIndex: 3, role: "support", shape: "rounded-rect", radius: 0.022 },
      { id: "support_mid", x: 0.56, y: 0.39, width: 0.35, height: 0.33, rotation: -2.5, zIndex: 1, role: "support", shape: "rounded-rect", radius: 0.022 },
      { id: "support_bottom", x: 0.46, y: 0.66, width: 0.36, height: 0.25, rotation: 1.5, zIndex: 2, role: "support", shape: "rounded-rect", radius: 0.022 },
    ],
  },
  {
    id: "triptych_mobile_equal",
    name: "Minimal Equal Triptych",
    type: "triptych",
    supportedRatios: MOBILE_RATIOS,
    minImages: 3,
    maxImages: 3,
    slots: [
      { id: "top", x: 0.035, y: 0.02, width: 0.93, height: 0.307, rotation: 0, zIndex: 1, role: "support", shape: "rect" },
      { id: "middle", x: 0.035, y: 0.347, width: 0.93, height: 0.306, rotation: 0, zIndex: 2, role: "hero", shape: "rect" },
      { id: "bottom", x: 0.035, y: 0.673, width: 0.93, height: 0.307, rotation: 0, zIndex: 1, role: "support", shape: "rect" },
    ],
  },
  {
    id: "triptych_mobile_editorial",
    name: "Editorial Hero + Two",
    type: "triptych",
    supportedRatios: MOBILE_RATIOS,
    minImages: 3,
    maxImages: 3,
    slots: [
      { id: "hero", x: 0.045, y: 0.025, width: 0.91, height: 0.63, rotation: 0, zIndex: 2, role: "hero", shape: "rounded-rect", radius: 0.025 },
      { id: "support_left", x: 0.045, y: 0.68, width: 0.435, height: 0.295, rotation: 0, zIndex: 1, role: "support", shape: "rounded-rect", radius: 0.025 },
      { id: "support_right", x: 0.52, y: 0.68, width: 0.435, height: 0.295, rotation: 0, zIndex: 1, role: "support", shape: "rounded-rect", radius: 0.025 },
    ],
  },
  {
    id: "triptych_mobile_cinematic",
    name: "Cinematic Edge-to-Edge",
    type: "triptych",
    supportedRatios: MOBILE_RATIOS,
    minImages: 3,
    maxImages: 3,
    slots: [
      { id: "top", x: 0, y: 0, width: 1, height: 0.333, rotation: 0, zIndex: 1, role: "support", shape: "rect" },
      { id: "middle", x: 0, y: 0.333, width: 1, height: 0.334, rotation: 0, zIndex: 2, role: "hero", shape: "rect" },
      { id: "bottom", x: 0, y: 0.667, width: 1, height: 0.333, rotation: 0, zIndex: 1, role: "support", shape: "rect" },
    ],
  },
  {
    id: "portrait_triptych_mobile",
    name: "Portrait Focus Triptych",
    type: "portrait-triptych",
    supportedRatios: MOBILE_RATIOS,
    minImages: 3,
    maxImages: 3,
    slots: [
      { id: "hero", x: 0.075, y: 0.06, width: 0.85, height: 0.55, rotation: 0, zIndex: 2, role: "hero", shape: "rounded-rect", radius: 0.03 },
      { id: "support_left", x: 0.075, y: 0.64, width: 0.405, height: 0.29, rotation: -1.5, zIndex: 1, role: "support", shape: "rounded-rect", radius: 0.028 },
      { id: "support_right", x: 0.52, y: 0.64, width: 0.405, height: 0.29, rotation: 1.5, zIndex: 1, role: "support", shape: "rounded-rect", radius: 0.028 },
    ],
  },
  {
    id: "layered_moodboard_mobile",
    name: "Layered Mobile Moodboard",
    type: "layered-moodboard",
    supportedRatios: MOBILE_RATIOS,
    minImages: 3,
    maxImages: 5,
    slots: [
      { id: "background", x: 0, y: 0, width: 1, height: 1, rotation: 0, zIndex: 0, role: "background", shape: "rect" },
      { id: "hero", x: 0.08, y: 0.09, width: 0.84, height: 0.5, rotation: -1.5, zIndex: 3, role: "hero", shape: "rounded-rect", radius: 0.03 },
      { id: "support_top", x: 0.12, y: 0.56, width: 0.47, height: 0.2, rotation: 2, zIndex: 2, role: "support", shape: "rounded-rect", radius: 0.026 },
      { id: "support_bottom", x: 0.35, y: 0.72, width: 0.52, height: 0.19, rotation: -2, zIndex: 2, role: "support", shape: "rounded-rect", radius: 0.026 },
    ],
  },
];

export const WALLPAPER_TEMPLATES = rawTemplates.map((template) =>
  wallpaperTemplateSchema.parse(template),
);

export const WALLPAPER_TEMPLATE_IDS = WALLPAPER_TEMPLATES.map(
  (template) => template.id,
);

export function getTemplate(templateId: string) {
  const template = WALLPAPER_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }
  return template;
}
