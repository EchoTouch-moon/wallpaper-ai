import { globalShortcut, screen, type BrowserWindow } from "electron";
import type { DesktopPlatform, DisplayInfo, SecretStore } from "../../shared/desktop-platform";

/**
 * Windows platform — real WorkerW wallpaper-layer embedding via direct
 * user32.dll calls (koffi FFI).
 *
 * Implements the full Lively/weebp sequence (WorkerW discovery by enumerating
 * the SHELLDLL_DefView host's next sibling, SetWindowPos with HWND_BOTTOM +
 * SWP_NOACTIVATE before and after SetParent). koffi is pure JS — no Rust
 * toolchain, no native rebuilds.
 *
 * Only imported when process.platform === "win32"; user32.ts loads user32.dll
 * at eval time (throws on non-Windows), so we use a dynamic import here.
 */

interface Win32Module {
  embedToDesktop(
    hwnd: Buffer,
    bounds: { x: number; y: number; width: number; height: number },
  ): boolean;
  inspectWindowState(hwnd: Buffer): {
    hwndValid: boolean;
    windowVisible: boolean;
    parentHwnd: number;
    parentIsWorkerW: boolean;
  };
  reassertBottomZOrder(
    hwnd: Buffer,
    bounds: { x: number; y: number; width: number; height: number },
  ): void;
  reEmbedOnly(hwnd: Buffer): number;
}

let modPromise: Promise<Win32Module> | null = null;
function loadModule(): Promise<Win32Module> {
  if (!modPromise) {
    modPromise = import("../win32/user32.js") as Promise<Win32Module>;
  }
  return modPromise;
}

/** Keep the last-used native handle + bounds for the guardian. */
let lastHwnd: Buffer | null = null;
let lastBounds: { x: number; y: number; width: number; height: number } | null = null;

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
      const mod = await loadModule();
      const primary = screen.getPrimaryDisplay();
      const b = primary.bounds;
      lastHwnd = window.getNativeWindowHandle();
      lastBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      try {
        embedded = mod.embedToDesktop(lastHwnd, lastBounds);
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

/**
 * Guardian tick: inspect the wallpaper window's Win32 state and re-embed if
 * it has been detached from WorkerW (Explorer rebuilt the desktop).
 *
 * CRITICAL: the healthy path does NOTHING — no SetWindowPos, no invalidate.
 * Earlier versions called reassertBottomZOrder() every tick even when healthy,
 * which itself perturbed the window and contributed to flicker. Per Lively/
 * weebp: the right pattern is tight polling (~250ms) that only acts on actual
 * detachment, so the steady state is silent.
 *
 * Returns a short status string for logging. Healthy ticks log nothing extra
 * (only the periodic heartbeat line from main).
 */
export async function guardianTick(): Promise<string> {
  if (!lastHwnd) return "no-window";
  const mod = await loadModule();
  const snap = mod.inspectWindowState(lastHwnd);
  if (!snap.hwndValid) {
    return `invalid-handle`;
  }
  if (!snap.parentIsWorkerW) {
    // Detached — Explorer rebuilt WorkerW. Re-embed without re-sending 0x052C
    // (re-sending triggers another rebuild cycle, feeding the flicker loop).
    const newParent = mod.reEmbedOnly(lastHwnd);
    return newParent !== 0
      ? `re-embedded into workerw=${newParent}`
      : `detached; no workerw yet (will retry next tick)`;
  }
  if (!snap.windowVisible) {
    mod.reassertBottomZOrder(lastHwnd, lastBounds ?? { x: 0, y: 0, width: 1920, height: 1080 });
    return `was-hidden; reasserted`;
  }
  // Healthy — do NOT touch the window. Return empty so main can skip logging.
  return "";
}
