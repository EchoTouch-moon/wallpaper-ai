export type WallpaperRatioId = "16:9" | "16:10" | "21:9" | "9:16" | "9:19.5";

export interface WallpaperRatio {
  id: WallpaperRatioId;
  label: string;
  width: number;
  height: number;
}
export type SafeAreaType =
  | "desktop-icons-left"
  | "desktop-icons-right"
  | "desktop-dock"
  | "mobile-clock"
  | "mobile-widget-center"
  | "subject-protection";

export interface SafeArea {
  id: string;
  type: SafeAreaType;
  x: number;
  y: number;
  width: number;
  height: number;
}
