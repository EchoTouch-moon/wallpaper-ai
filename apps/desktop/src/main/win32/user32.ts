import koffi from "koffi";

/**
 * Win32 user32.dll FFI bindings via koffi.
 *
 * Windows-only — user32.dll does not exist on macOS/Linux. Imported
 * dynamically only by the win32 platform implementation. The load() call
 * below throws on non-Windows, so guard the import site with
 * process.platform === "win32".
 *
 * Implements the canonical "draw behind desktop icons" sequence verified
 * across three mature open-source wallpaper apps (weebp, Lively Wallpaper,
 * SpoutWallpaper):
 *
 *   1. FindWindow("Progman")
 *   2. SendMessageTimeout(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000) spawn WorkerW
 *   3. EnumWindows: find the top-level containing SHELLDLL_DefView, take its
 *      NEXT sibling WorkerW — the wallpaper-paint WorkerW
 *   4. SetWindowPos(HWND_BOTTOM, SWP_NOACTIVATE)  // pre-position, DO NOT activate
 *   5. SetParent(ourWindow, workerW)
 *   6. SetWindowPos(HWND_BOTTOM, SWP_NOACTIVATE)  // re-position after reparent
 *
 * Click-through to desktop icons is automatic from the window hierarchy
 * (icons live in SHELLDLL_DefView, a sibling ABOVE our WorkerW child) — no
 * WS_EX_TRANSPARENT / setIgnoreMouseEvents needed, per Lively's design.
 *
 * HWND values are passed as IntPtr numbers throughout (koffi marshals them
 * to pointer-sized ints). Electron's getNativeWindowHandle() returns the raw
 * HWND bytes; we read them as a uintptr_t.
 *
 * Refs:
 *   - https://github.com/rocksdanister/lively (SetupDesktop.cs)
 *   - https://github.com/Francesco149/weebp (weebp.c)
 *   - https://www.codeproject.com/Articles/856020/Draw-Behind-Desktop-Icons-in-Windows-plus
 */

// --- Constants -------------------------------------------------------------

// SetWindowPos hWndInsertAfter special values (signed: 0=TOP, 1=BOTTOM,
// -1=TOPMOST, -2=NOTOPMOST). We use HWND_BOTTOM to push the wallpaper to the
// bottom of WorkerW's child Z-order so SHELLDLL_DefView (icons) stays on top.
const HWND_BOTTOM = 1;
const SWP_NOACTIVATE = 0x0010; // never activate the wallpaper window
const SMTO_NORMAL = 0x0000;
const WM_SPAWN_WORKERW = 0x052c; // undocumented; makes Progman spawn WorkerW

// --- user32.dll load + declarations (HWND as intptr_t numbers) -----------

const user32 = koffi.load("user32.dll");

const FindWindowW = user32.func("__stdcall", "FindWindowW", "int64", [
  "wstring",
  "wstring",
]);

const FindWindowExW = user32.func(
  "__stdcall",
  "FindWindowExW",
  "int64",
  ["int64", "int64", "wstring", "wstring"],
);

const SendMessageTimeoutW = user32.func(
  "__stdcall",
  "SendMessageTimeoutW",
  "int64",
  [
    "int64", // hWnd
    "uint32", // Msg
    "uintptr", // wParam
    "intptr", // lParam
    "uint32", // fuFlags
    "uint32", // uTimeout
    koffi.out(koffi.pointer("uint64")), // lpdwResult
  ],
);

// EnumWindows callback: BOOL (*)(HWND, LPARAM)
const EnumWindowsProc = koffi.proto("__stdcall", "EnumWindowsProc", "int", [
  "int64",
  "intptr",
]);
const EnumWindows = user32.func("__stdcall", "EnumWindows", "int", [
  koffi.pointer(EnumWindowsProc),
  "intptr",
]);

const SetParent = user32.func("__stdcall", "SetParent", "int64", [
  "int64",
  "int64",
]);

const SetWindowPos = user32.func("__stdcall", "SetWindowPos", "int", [
  "int64", // hWnd
  "int64", // hWndInsertAfter (HWND_BOTTOM = 1)
  "int", // X
  "int", // Y
  "int", // cx
  "int", // cy
  "uint32", // uFlags
]);

// --- Diagnostics (for the P1.7 watchdog: is the window still parented and visible?) ---

const IsWindow = user32.func("__stdcall", "IsWindow", "int", ["int64"]);
const IsWindowVisible = user32.func("__stdcall", "IsWindowVisible", "int", ["int64"]);
const GetParent = user32.func("__stdcall", "GetParent", "int64", ["int64"]);

// --- Helpers ---------------------------------------------------------------

/** Read an Electron BrowserWindow's HWND from its native handle Buffer. */
function readHwnd(buf: Buffer): number {
  // HWND is pointer-sized: 8 bytes on 64-bit Windows, 4 on 32-bit. Read big
  // enough; readUIntLE handles any width up to 6 safely, so for 8 we read in
  // two halves. In practice Electron ships 64-bit on Windows, so length is 8.
  if (buf.length >= 8) {
    return Number(buf.readBigUInt64LE(0));
  }
  return buf.readUInt32LE(0);
}

/**
 * Discover the wallpaper-paint WorkerW: the NEXT sibling (of class "WorkerW")
 * after the top-level that contains SHELLDLL_DefView. Handles both the normal
 * case (SHELLDLL_DefView under Progman) and the slideshow case (moved into a
 * WorkerW).
 */
function findWallpaperWorkerW(): number {
  let workerW = 0;

  const callback = koffi.register((hwnd: number, _lParam: number): number => {
    const shellView = FindWindowExW(hwnd, 0, "SHELLDLL_DefView", null);
    if (shellView !== 0) {
      const sibling = FindWindowExW(0, hwnd, "WorkerW", null);
      if (sibling !== 0) {
        workerW = sibling;
        return 0; // FALSE — stop enumeration
      }
    }
    return 1; // TRUE — continue
  }, koffi.pointer(EnumWindowsProc));

  EnumWindows(callback, 0);
  koffi.unregister(callback);
  return workerW;
}

// --- Public API ------------------------------------------------------------

/**
 * Embed the given window into the desktop wallpaper layer.
 *
 * @param hwndPtr Buffer from Electron BrowserWindow.getNativeWindowHandle()
 * @param displayBounds absolute screen bounds {x,y,width,height} of the target monitor
 * @returns true on success
 */
export function embedToDesktop(
  hwndPtr: Buffer,
  displayBounds: { x: number; y: number; width: number; height: number },
): boolean {
  const hwnd = readHwnd(hwndPtr);

  const progman = FindWindowW("Progman", null);
  if (progman === 0) {
    console.error("[win32] Progman not found");
    return false;
  }

  // Spawn the wallpaper WorkerW (idempotent — no-op if already present).
  SendMessageTimeoutW(progman, WM_SPAWN_WORKERW, 0, 0, SMTO_NORMAL, 1000, [0]);

  const workerW = findWallpaperWorkerW();
  if (workerW === 0) {
    console.error("[win32] wallpaper WorkerW not found");
    return false;
  }

  // Pre-position at HWND_BOTTOM on the target monitor. SWP_NOACTIVATE is
  // critical — without it Win11 destroys the reparented window.
  SetWindowPos(
    hwnd,
    HWND_BOTTOM,
    displayBounds.x,
    displayBounds.y,
    displayBounds.width,
    displayBounds.height,
    SWP_NOACTIVATE,
  );

  // Reparent into WorkerW.
  if (SetParent(hwnd, workerW) === 0) {
    console.error("[win32] SetParent failed");
    return false;
  }

  // Re-position at HWND_BOTTOM in WorkerW after reparenting. (Multi-monitor
  // MapWindowPoints remap lands with per-monitor support in a later phase.)
  SetWindowPos(
    hwnd,
    HWND_BOTTOM,
    displayBounds.x,
    displayBounds.y,
    displayBounds.width,
    displayBounds.height,
    SWP_NOACTIVATE,
  );

  return true;
}

/**
 * Snapshot of the wallpaper window's state for the guardian watchdog.
 * Every field is a concrete observable so logs tell us exactly what changed.
 */
export interface WindowStateSnapshot {
  hwndValid: boolean; // IsWindow(hwnd)
  windowVisible: boolean; // IsWindowVisible(hwnd) — has WS_VISIBLE
  parentHwnd: number; // GetParent(hwnd) — should be the WorkerW
  parentIsWorkerW: boolean; // true if parent class == "WorkerW"
}

const GW_OWNER = 0;
// GetClassNameW(HWND, LPWSTR, int maxCount)
const GetClassNameW = user32.func("__stdcall", "GetClassNameW", "int", [
  "int64",
  koffi.out(koffi.array("uint16", 256)),
  "int",
]);

/** Read a window's class name (e.g. "WorkerW", "Progman"). */
function getClassName(hwnd: number): string {
  const buf = new Uint16Array(256);
  const r = GetClassNameW(hwnd, buf, 256);
  if (r <= 0) return "";
  let s = "";
  for (let i = 0; i < r; i++) s += String.fromCharCode(buf[i]);
  return s;
}

/**
 * Inspect the wallpaper window's current Win32 state. The guardian calls
 * this every few seconds and logs changes; if the window got detached from
 * WorkerW (Explorer rebuilt it) or hidden, we re-embed.
 */
export function inspectWindowState(hwndPtr: Buffer): WindowStateSnapshot {
  const hwnd = readHwnd(hwndPtr);
  const hwndValid = IsWindow(hwnd) !== 0;
  if (!hwndValid) {
    return { hwndValid: false, windowVisible: false, parentHwnd: 0, parentIsWorkerW: false };
  }
  const windowVisible = IsWindowVisible(hwnd) !== 0;
  const parentHwnd = GetParent(hwnd);
  const parentIsWorkerW = parentHwnd !== 0 && getClassName(parentHwnd) === "WorkerW";
  return { hwndValid, windowVisible, parentHwnd, parentIsWorkerW };
  // Note: GW_OWNER unused — kept conceptually; remove if lint complains.
  void GW_OWNER;
}

/**
 * Re-assert the wallpaper window's position at the bottom of WorkerW's
 * Z-order without re-parenting. The guardian calls this when the window is
 * still parented correctly but may have been pushed up in Z-order.
 */
export function reassertBottomZOrder(
  hwndPtr: Buffer,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const hwnd = readHwnd(hwndPtr);
  if (IsWindow(hwnd) === 0) return;
  SetWindowPos(
    hwnd,
    HWND_BOTTOM,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    SWP_NOACTIVATE,
  );
}
