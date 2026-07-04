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
    // active window. After WorkerW reparenting, the window sits structurally
    // behind SHELLDLL_DefView (icons), so click-through to icons is automatic —
    // no setIgnoreMouseEvents / WS_EX_TRANSPARENT needed (per Lively design).
    focusable: false,
    alwaysOnTop: false,
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

  // Show the window BEFORE embedding: attach() needs a valid HWND, and a
  // hidden window's handle can be invalid for reparenting.
  window.show();

  // Load the renderer BEFORE embedding. Counter to the earlier ordering, this
  // lets the GPU compositor start presenting while the window is still a
  // normal top-level window. Reparenting via Win32 SetParent after the
  // compositor is already running is more reliable than loading into an
  // already-reparented window (where the swap chain may not initialize).
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  console.log("[main] loading renderer...");
  if (devUrl) {
    await window.loadURL(devUrl);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Forward ALL renderer console messages and load failures to the main
  // process stdout. The wallpaper window has no visible DevTools by default,
  // so this is how we see renderer-side errors during Windows verification.
  window.webContents.on("console-message", (_e, level, message, line, source) => {
    console.log(`[renderer:${["log", "warn", "error"][level] ?? "log"}] ${message} (${source}:${line})`);
  });
  window.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[renderer] did-fail-load ${code} ${desc} — ${url}`);
  });
  window.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[renderer] render-process-gone: ${details.reason}`);
  });

  // Open DevTools in a detached window during dev, so renderer errors and the
  // DOM are inspectable even though the wallpaper window itself is embedded
  // behind desktop icons (where its own DevTools would be unreachable).
  if (!app.isPackaged) {
    window.webContents.openDevTools({ mode: "detach" });
  }

  console.log("[main] renderer loaded, now embedding into wallpaper layer...");

  const embedded = await platform.embedToWallpaperLayer(window);
  if (embedded) {
    console.log(`[main] embedded into wallpaper layer (${platform.name})`);
  } else {
    console.log(
      `[main] wallpaper layer embedding skipped/failed (${platform.name}); window stays visible`,
    );
  }

  // Force a repaint after embedding. Win32 SetParent into WorkerW can leave
  // Electron's GPU compositor in a state where it stops presenting; nudging
  // the window size and invalidating forces a fresh swap chain and repaint.
  // Multiple strategies because the exact trigger varies by Windows/DWM build.
  const w = window.getBounds().width;
  const h = window.getBounds().height;
  window.setBounds({ width: w + 1, height: h + 1 });
  window.setBounds({ width: w, height: h });
  // webContents.invalidate() forces the compositor to repaint.
  window.webContents.invalidate();
  window.webContents.setBackgroundThrottling(false);
  console.log("[main] repaint triggered");
}

// CRITICAL for the wallpaper-layer technique: disable GPU hardware
// acceleration. Chromium's GPU compositor binds a Direct3D swap chain to the
// window's HWND and its position in the window tree. When Win32 SetParent
// reparents the BrowserWindow into WorkerW (a window owned by explorer.exe),
// that swap chain is invalidated and Chromium never rebuilds it — so the web
// content stops presenting and only the window's native grey background shows.
//
// Software rendering (CPU) doesn't use a GPU swap chain, so reparenting
// doesn't break presentation. This is the same mode used by kiosk/digital-
// signage Electron apps that embed windows in unusual parents. Performance is
// fine for a static-ish wallpaper (no full-screen video).
//
// This MUST be called before app.whenReady().
app.disableHardwareAcceleration();
console.log("[main] hardware acceleration disabled (software render mode)");

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
