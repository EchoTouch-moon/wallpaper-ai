import type { WallpaperRatio } from "../types/wallpaper";

export const RATIO_PRESETS: WallpaperRatio[] = [
  { id: "16:9", label: "16:9 Desktop", width: 1920, height: 1080 },
  { id: "16:10", label: "16:10 Laptop", width: 2560, height: 1600 },
  { id: "21:9", label: "21:9 Ultrawide", width: 3440, height: 1440 },
  { id: "9:16", label: "9:16 Mobile", width: 1290, height: 2293 },
  { id: "9:19.5", label: "9:19.5 Lock screen", width: 1290, height: 2795 },
];

export function getRatioPreset(id: WallpaperRatio["id"]) {
  return RATIO_PRESETS.find((ratio) => ratio.id === id) ?? RATIO_PRESETS[0];
}
