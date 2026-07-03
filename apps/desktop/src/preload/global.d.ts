import type { WallpaperApi } from "./index";

declare global {
  interface Window {
    wallpaper: WallpaperApi;
  }
}

export {};
