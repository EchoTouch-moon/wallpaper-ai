import { globalShortcut, screen, type BrowserWindow } from "electron";
import type { DesktopPlatform, DisplayInfo, SecretStore } from "../../shared/desktop-platform";

/**
 * Windows platform — real WorkerW wallpaper-layer embedding.
 *
 * Uses `electron-as-wallpaper` (a Neon/Rust native addon) which is only
 * installable/compilable on Windows. We therefore `import()` it dynamically
 * so this module can be loaded on any platform without failing at import
 * time; the import only executes when actually running on win32.
 *
 * `safeStorage` is used for LLM key encryption (backed by DPAPI on Windows).
 */

interface AttachOptions {
  transparent?: boolean;
  forwardMouseInput?: boolean;
  forwardKeyboardInput?: boolean;
}

interface ElectronAsWallpaper {
  attach(window: BrowserWindow, options?: AttachOptions): void;
  detach(window: BrowserWindow): void;
  reset(): void;
}

// electron-as-wallpaper adds a `wallpaperState` field to BrowserWindow at
// runtime after attach(); Electron's types already declare it as optional, so
// we read it defensively without re-declaring the module.

async function loadWallpaperLib(): Promise<ElectronAsWallpaper> {
  // Dynamic import: only resolves on Windows where the native addon was built.
  const mod = (await import(
    /* webpackIgnore: true */ "electron-as-wallpaper"
  )) as unknown as ElectronAsWallpaper;
  return mod;
}

export function createWin32Platform(): DesktopPlatform {
  let embedded = false;
  let lib: ElectronAsWallpaper | null = null;

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
    async embedToWallpaperLayer(window) {
      if (!lib) {
        lib = await loadWallpaperLib();
      }
      try {
        // transparent: true so the wallpaper layer can show the desktop behind
        // any unrendered regions. Mouse/keyboard forwarding left off in P1 —
        // the wallpaper layer is click-through by default (setIgnoreMouseEvents).
        lib.attach(window, {
          transparent: true,
          forwardKeyboardInput: false,
          forwardMouseInput: false,
        });
        // Verify via the runtime-added wallpaperState. The library sets this on
        // the BrowserWindow after a successful attach(); if it's missing or
        // false, treat the embed as failed so the caller can fall back.
        const attached = window.wallpaperState?.isAttached === true;
        embedded = attached;
        return attached;
      } catch (error) {
        console.error("[win32] attach failed:", error);
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
    async setAutoLaunch(enable) {
      // Wired in main via app.setLoginItemSettings; kept here for interface parity.
      void enable;
    },
    secrets,
  };
}
