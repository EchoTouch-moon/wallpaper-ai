import { app, BrowserWindow, ipcMain, globalShortcut } from "electron";
import { join } from "node:path";
import {
  resolvePlatformChoice,
  type DesktopPlatform,
} from "../shared/desktop-platform";
import { createMockPlatform } from "./platform/mock";
import { createWin32Platform } from "./platform/win32";

function createPlatform(): DesktopPlatform {
  const choice = resolvePlatformChoice();
  return choice === "win32" ? createWin32Platform() : createMockPlatform();
}

/**
 * Register IPC handlers BEFORE the renderer loads, so the renderer never sees
 * a missing-handler race on first paint. (P1 Windows verification, error 6
 * timing concern.)
 */
function registerIpc(platform: DesktopPlatform): void {
  ipcMain.handle("platform:name", () => platform.name);
  ipcMain.handle("platform:embedded", () => platform.isEmbedded());
  ipcMain.handle("platform:displays", () => platform.getDisplays());

  // P2 hook: swap a slot. Stubbed here; full swap engine lands in P2.
  ipcMain.handle(
    "layout:swapSlot",
    async (_event, slotId: string, assetId?: string) => {
      // TODO(P2): call core swap engine, broadcast patch to renderer.
      console.log(`[main] swapSlot(slotId=${slotId}, assetId=${assetId})`);
      return { slotId, assetId: assetId ?? null, ok: false, reason: "not-implemented" };
    },
  );

  // Mock-only: in-window shortcut trigger (mock platform can't capture globals).
  ipcMain.on("mock:shortcut", (_event, action: string) => {
    if (platform.name === "mock") {
      console.log(`[main] mock shortcut fired: ${action}`);
    }
  });
}

function createWallpaperWindow(): BrowserWindow {
  const displays = require("electron").screen.getAllDisplays();
  const primary = displays[0];
  const width = primary ? primary.bounds.width : 1920;
  const height = primary ? primary.bounds.height : 1080;

  const window = new BrowserWindow({
    width,
    height,
    x: primary?.bounds.x ?? 0,
    y: primary?.bounds.y ?? 0,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // The wallpaper layer must NOT steal focus or float above everything.
    // focusable:false + alwaysOnTop:false keep it from disrupting the user's
    // active window and (combined with WorkerW reparenting + SetWindowPos
    // patch) let it sit behind desktop icons. (P1 Windows verification, error 6.)
    focusable: false,
    alwaysOnTop: false,
    transparent: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  return window;
}

async function bootstrap(): Promise<void> {
  const platform = createPlatform();

  // Register IPC up front so handlers exist before renderer requests them.
  registerIpc(platform);

  const window = createWallpaperWindow();

  // Show the window BEFORE embedding: electron-as-wallpaper's attach() needs a
  // valid HWND, and a hidden window's handle can be invalid for reparenting.
  // (P1 Windows verification, error 6 timing.)
  window.show();

  console.log("[main] window shown, now attempting wallpaper-layer embed...");
  const embedded = await platform.embedToWallpaperLayer(window);
  if (embedded) {
    console.log(`[main] embedded into wallpaper layer (${platform.name})`);
  } else {
    console.log(
      `[main] wallpaper layer embedding skipped/failed (${platform.name}); window stays visible`,
    );
  }

  // Load renderer AFTER embedding so first paint happens in the right layer.
  // Dev: electron-vite injects ELECTRON_RENDERER_URL; prod: load built file.
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    await window.loadURL(devUrl);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Click-through by default: clicks fall through to desktop icons. The
  // `{ forward: true }` keeps mousemove events flowing so the renderer can
  // implement hover highlights in a future "interactive mode".
  window.setIgnoreMouseEvents(true, { forward: true });
}

// Single instance lock — second launches focus the existing app instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // No editor window yet in P1; nothing to focus. Hook for later.
  });

  app.whenReady().then(() => {
    bootstrap().catch((error) => {
      console.error("[main] bootstrap failed:", error);
      app.quit();
    });
  });

  app.on("will-quit", () => {
    // Release any registered global shortcuts.
    globalShortcut.unregisterAll();
  });

  app.on("window-all-closed", () => {
    // On macOS keep the wallpaper process alive; elsewhere quit.
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

export {};
