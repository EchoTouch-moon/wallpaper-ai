import { contextBridge, ipcRenderer } from "electron";
import type { WallpaperApi } from "../shared/wallpaper-api";

/**
 * Surface exposed to the wallpaper renderer under `window.wallpaper`.
 * Kept intentionally minimal for P1; grows in P2 (swap engine) and beyond.
 */
const wallpaper: WallpaperApi = {
  getPlatformName: (): Promise<string> => ipcRenderer.invoke("platform:name"),
  isEmbedded: (): Promise<boolean> => ipcRenderer.invoke("platform:embedded"),
  getDisplays: () => ipcRenderer.invoke("platform:displays"),
  swapSlot: (slotId: string, assetId?: string) =>
    ipcRenderer.invoke("layout:swapSlot", slotId, assetId),
  // Mock-only: notify main that an in-window shortcut was pressed (since the
  // mock platform cannot capture OS-global shortcuts).
  notifyMockShortcut: (action: string) => ipcRenderer.send("mock:shortcut", action),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("wallpaper", wallpaper);
  } catch (error) {
    console.error("[preload] failed to expose wallpaper API:", error);
  }
} else {
  window.wallpaper = wallpaper;
}

export type { WallpaperApi } from "../shared/wallpaper-api";
