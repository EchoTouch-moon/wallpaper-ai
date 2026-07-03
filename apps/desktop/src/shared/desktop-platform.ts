import type { BrowserWindow } from "electron";

/**
 * Abstraction over the platform-specific parts of the wallpaper layer.
 *
 * Why this exists: WorkerW embedding, global shortcuts, auto-launch, and
 * secret storage are Windows-only and (for electron-as-wallpaper) require a
 * Rust toolchain to compile. To let the business logic run and be developed
 * on macOS, we inject a mock implementation there and the real Windows
 * implementation on win32.
 *
 * The implementation is chosen at main-process startup based on
 * `process.platform` (or the `WALLPAPER_PLATFORM` env override).
 */

export interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DesktopPlatform {
  /** Human-readable name for logging/diagnostics (e.g. "win32", "mock"). */
  readonly name: string;

  /**
   * Embed the given BrowserWindow into the desktop wallpaper layer (behind
   * desktop icons). On Windows this reparents the window into WorkerW via
   * electron-as-wallpaper. The mock implementation just shows the window
   * normally (no embedding).
   *
   * Returns true if the window was actually embedded; false on mock.
   */
  embedToWallpaperLayer(window: BrowserWindow): Promise<boolean>;

  /** Whether the last embedToWallpaperLayer call actually embedded. */
  isEmbedded(): boolean;

  /**
   * Register a global keyboard shortcut. Returns true on success, false if
   * the accelerator is invalid or already taken. The mock implementation
   * only works while the window is focused (no global capture).
   */
  registerGlobalShortcut(accelerator: string, handler: () => void): boolean;

  /** Unregister a previously registered shortcut. */
  unregisterGlobalShortcut(accelerator: string): void;

  /** List all displays with their physical bounds and scale factors. */
  getDisplays(): DisplayInfo[];

  /** Enable/disable launching at OS login. */
  setAutoLaunch(enable: boolean): Promise<void>;

  /** Encrypted storage for secrets like LLM API keys. */
  readonly secrets: SecretStore;
}

/**
 * Resolve which platform implementation to use.
 * The `WALLPAPER_PLATFORM=mock` env var forces the mock (used by `dev:mock`
 * on macOS for development).
 */
export function resolvePlatformChoice(): "win32" | "mock" {
  const override = process.env.WALLPAPER_PLATFORM;
  if (override === "mock" || override === "win32") {
    return override;
  }
  return process.platform === "win32" ? "win32" : "mock";
}
