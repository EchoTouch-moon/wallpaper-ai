import { app, BrowserWindow, ipcMain } from "electron";
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

function createWallpaperWindow(platform: DesktopPlatform): BrowserWindow {
  const displays = platform.getDisplays();
  const primary = displays[0];
  const width = primary ? Math.round(primary.bounds.width * 1) : 1920;
  const height = primary ? Math.round(primary.bounds.height * 1) : 1080;

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
    // Wallpaper layer must not steal focus from the desktop by default.
    focusable: true,
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

  const window = createWallpaperWindow(platform);

  // Load renderer: dev server URL (electron-vite injects it) or built file.
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    await window.loadURL(devUrl);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Attempt wallpaper-layer embedding. On mock this is a no-op and the window
  // just shows normally (useful for developing the renderer on macOS).
  const embedded = await platform.embedToWallpaperLayer(window);
  if (embedded) {
    console.log(`[main] embedded into wallpaper layer (${platform.name})`);
  } else {
    console.log(
      `[main] wallpaper layer embedding skipped (${platform.name}); showing window normally`,
    );
  }

  window.show();
  window.setIgnoreMouseEvents(true, { forward: true });

  // --- IPC: minimal P1 surface ---
  // Renderer asks for the active platform name (for diagnostics / UI badges).
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

  // Mock-only: expose a manual shortcut trigger from the renderer, since the
  // mock platform does not capture OS-global shortcuts.
  ipcMain.on("mock:shortcut", (_event, action: string) => {
    if (platform.name === "mock") {
      console.log(`[main] mock shortcut fired: ${action}`);
    }
  });
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

  app.on("window-all-closed", () => {
    // On macOS keep the wallpaper process alive; elsewhere quit.
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

export {};
