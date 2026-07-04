import type { WallpaperApi } from "../shared/wallpaper-api";

declare global {
  interface Window {
    /**
     * Present in Electron through the preload bridge. Optional because the
     * renderer is also packaged as a standalone Octos/WebView2 wallpaper.
     */
    wallpaper?: WallpaperApi;
  }
}

export {};
