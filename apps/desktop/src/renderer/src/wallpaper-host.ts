import type { WallpaperApi } from "../../shared/wallpaper-api";

/**
 * Detect the native WebView2 bridge without depending on Octos' JavaScript
 * SDK. Octos exposes this object because it hosts the renderer in WebView2.
 */
function hasWebView2Bridge(): boolean {
  const chromeValue: unknown = Reflect.get(window, "chrome");
  if (typeof chromeValue !== "object" || chromeValue === null) {
    return false;
  }
  return Reflect.get(chromeValue, "webview") !== undefined;
}

function isOctosHost(): boolean {
  return hasWebView2Bridge() && window.location.hostname.endsWith(".octos");
}

/**
 * Browser/WebView2 fallback used when Electron's preload bridge is absent.
 *
 * P1 only needs platform diagnostics. Native commands stay explicitly
 * unsupported until wallpaper-host.exe owns the production IPC bridge.
 */
function createStandaloneHost(): WallpaperApi {
  const octos = isOctosHost();
  const webView2 = hasWebView2Bridge();

  return {
    getPlatformName: async () =>
      octos ? "octos-webview2" : webView2 ? "webview2" : "browser",
    isEmbedded: async () => webView2,
    getDisplays: async () => [
      {
        id: 0,
        bounds: {
          x: 0,
          y: 0,
          width: window.screen.width,
          height: window.screen.height,
        },
        scaleFactor: window.devicePixelRatio,
      },
    ],
    swapSlot: async (slotId: string, assetId?: string) => ({
      slotId,
      assetId: assetId ?? null,
      ok: false,
      reason: "host-api-unavailable",
    }),
    notifyMockShortcut: () => undefined,
  };
}

export const wallpaperHost: WallpaperApi =
  window.wallpaper ?? createStandaloneHost();
