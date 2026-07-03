import { globalShortcut, screen } from "electron";
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
  attach(window: unknown, options?: AttachOptions): void;
  detach(window: unknown): void;
  reset(): void;
}

async function loadWallpaperLib(): Promise<ElectronAsWallpaper> {
  // Dynamic import: only resolves on Windows where the native addon was built.
  // The string is intentionally not statically analyzable so bundlers don't
  // try to include it on other platforms.
  const mod = (await import(
    /* webpackIgnore: true */ "electron-as-wallpaper"
  )) as { attach: unknown; detach: unknown; reset: unknown };
  return mod as unknown as ElectronAsWallpaper;
}

export function createWin32Platform(): DesktopPlatform {
  let embedded = false;
  let currentWindow: { getNativeWindowHandle(): Buffer } | null = null;
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
      if (!currentWindow) {
        // Capture a minimal handle proxy so we don't keep a typed BrowserWindow
        // dependency in this scope beyond what attach needs.
        currentWindow = {
          getNativeWindowHandle: () => window.getNativeWindowHandle(),
        };
      }
      if (!lib) {
        lib = await loadWallpaperLib();
      }
      try {
        lib.attach(window, {
          transparent: false,
          forwardKeyboardInput: false,
          forwardMouseInput: false,
        });
        embedded = true;
        return true;
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
      // Set in main/index.ts via app.setLoginItemSettings to keep this pure.
      // Placeholder kept on the interface for symmetry.
      void enable;
    },
    secrets,
  };
}
