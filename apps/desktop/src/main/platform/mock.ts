import { screen } from "electron";
import type { DesktopPlatform, DisplayInfo, SecretStore } from "../../shared/desktop-platform";

/**
 * Mock platform — runs anywhere (used on macOS for development).
 *
 * - embedToWallpaperLayer: no-op, just shows the window normally so the
 *   wallpaper UI can be developed and verified without WorkerW.
 * - registerGlobalShortcut: in-memory only (no OS-level global capture),
 *   so shortcuts fire only while the app window is focused.
 * - secrets: plaintext JSON in a temp file (NOT secure — dev only).
 */
export function createMockPlatform(): DesktopPlatform {
  const registry = new Map<string, () => void>();

  const secrets: SecretStore = {
    async get(key) {
      return process.env[`WALLPAPER_SECRET_${key}`] ?? null;
    },
    async set(key, value) {
      process.env[`WALLPAPER_SECRET_${key}`] = value;
    },
    async delete(key) {
      delete process.env[`WALLPAPER_SECRET_${key}`];
    },
  };

  return {
    name: "mock",
    async embedToWallpaperLayer() {
      return false;
    },
    isEmbedded() {
      return false;
    },
    registerGlobalShortcut(accelerator, handler) {
      // Mock: remember it but we only dispatch from focused window via the
      // renderer-side Mousetrap equivalent (see renderer). Real global capture
      // is verified on Windows.
      registry.set(accelerator, handler);
      return true;
    },
    unregisterGlobalShortcut(accelerator) {
      registry.delete(accelerator);
    },
    getDisplays(): DisplayInfo[] {
      return screen.getAllDisplays().map((d) => ({
        id: d.id,
        bounds: { ...d.bounds },
        scaleFactor: d.scaleFactor,
      }));
    },
    async setAutoLaunch() {
      // no-op in mock
    },
    secrets,
  };
}
