import type { WallpaperLayout } from "../types/layout";
import type { WallpaperRatioId } from "../types/wallpaper";

export function createSafeAreas(
  ratioId: WallpaperRatioId,
  width: number,
  height: number,
): WallpaperLayout["safeAreas"] {
  if (ratioId === "9:16" || ratioId === "9:19.5") {
    return [
      {
        id: "mobile_clock",
        type: "mobile-clock",
        x: Math.round(width * 0.17),
        y: Math.round(height * 0.035),
        width: Math.round(width * 0.66),
        height: Math.round(height * 0.17),
      },
      {
        id: "mobile_widgets",
        type: "mobile-widget-center",
        x: Math.round(width * 0.12),
        y: Math.round(height * 0.25),
        width: Math.round(width * 0.76),
        height: Math.round(height * 0.18),
      },
    ];
  }

  return [
    {
      id: "desktop_icons",
      type: "desktop-icons-left",
      x: 0,
      y: Math.round(height * 0.05),
      width: Math.round(width * 0.16),
      height: Math.round(height * 0.82),
    },
    {
      id: "desktop_dock",
      type: "desktop-dock",
      x: Math.round(width * 0.22),
      y: Math.round(height * 0.9),
      width: Math.round(width * 0.56),
      height: Math.round(height * 0.1),
    },
  ];
}
