import { globalShortcut, screen, type BrowserWindow } from "electron";
import type { DesktopPlatform, DisplayInfo, SecretStore } from "../../shared/desktop-platform";

/**
 * Windows platform — real WorkerW wallpaper-layer embedding via direct
 * user32.dll calls (koffi FFI).
 *
 * Why not `electron-as-wallpaper` (Neon/Rust addon)? That package omits two
 * load-bearing steps of the canonical sequence (WorkerW discovery by
 * enumerating the SHELLDLL_DefView host, and SWP_NOACTIVATE), so the embedded
 * window occludes desktop icons and gets destroyed by Win11. We implement the
 * full Lively/weebp sequence directly. koffi is pure JS — no Rust toolchain,
 * no native rebuilds — so Windows setup no longer needs Rust/VS Build Tools.
 *
 * This module is only imported when process.platform === "win32" (see
 * resolvePlatformChoice). The user32.ts module loads user32.dll at eval time,
 * which throws on non-Windows, so we use a dynamic import here too.
 */

let embedFn: ((hwnd: Buffer, bounds: { x: number; y: number; width: number; height: number }) => boolean) | null =
  null;

async function loadEmbedFn() {
  if (embedFn) return embedFn;
  const mod = await import("../win32/user32.js");
  embedFn = mod.embedToDesktop;
  return embedFn;
}

export function createWin32Platform(): DesktopPlatform {
  let embedded = false;

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
    name: "win32",
    async embedToWallpaperLayer(window: BrowserWindow): Promise<boolean> {
      const embed = await loadEmbedFn();
      // Use the primary display's bounds (MVP single-monitor). Multi-monitor
      // arrives in a later phase: one wallpaper window per display, each
      // parented into the same WorkerW via MapWindowPoints.
      const primary = screen.getPrimaryDisplay();
      const b = primary.bounds;
      try {
        embedded = embed(window.getNativeWindowHandle(), {
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        });
        return embedded;
      } catch (error) {
        console.error("[win32] embed failed:", error);
        embedded = false;
        return false;
      }
    },
    isEmbedded() {
      return embedded;
    },
    registerGlobalShortcut(accelerator, handler) {
      return globalShortcut.register(accelerator, handler);
    },
    unregisterGlobalShortcut(accelerator) {
      globalShortcut.unregister(accelerator);
    },
    getDisplays(): DisplayInfo[] {
      return screen.getAllDisplays().map((d) => ({
        id: d.id,
        bounds: { ...d.bounds },
        scaleFactor: d.scaleFactor,
      }));
    },
    async setAutoLaunch(_enable) {
      // Wired in main via app.setLoginItemSettings; kept for interface parity.
    },
    secrets,
  };
}
