import type { DisplayInfo } from "./desktop-platform";

export interface SwapSlotResult {
  slotId: string;
  assetId: string | null;
  ok: boolean;
  reason: string;
}

/**
 * Host contract consumed by the wallpaper renderer.
 *
 * Electron implements it through preload IPC today. Octos uses the standalone
 * fallback, and wallpaper-host.exe can implement the same surface later.
 */
export interface WallpaperApi {
  getPlatformName(): Promise<string>;
  isEmbedded(): Promise<boolean>;
  getDisplays(): Promise<DisplayInfo[]>;
  swapSlot(slotId: string, assetId?: string): Promise<SwapSlotResult>;
  notifyMockShortcut(action: string): void;
}
