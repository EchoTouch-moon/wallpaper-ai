import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// Modules that must stay external (resolved from node_modules at runtime, not
// bundled). electron-vite's externalizeDepsPlugin() is unreliable with
// electron-vite 5 + Electron 43 — it fails to externalize `electron`, so the
// built main/preload end up `require`ing electron's install script (which
// returns the binary path string, not the API). Declaring `external` explicitly
// on each target fixes that. koffi is bundled (pure JS, no native deps).
//
// Ref: P1 Windows verification (error 3 & 5); koffi external per P1.2 (require
// identifier clash between electron-vite's CJS shim and koffi's bundled code).
const mainExternal = ["electron", "koffi"];
const preloadExternal = ["electron"];

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
        external: mainExternal,
      },
    },
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        external: preloadExternal,
      },
    },
  },
  renderer: {
    root: "src/renderer",
    // Keep renderer assets relative so the same static bundle works both with
    // Electron's loadFile() and inside an Octos/WebView2 wallpaper package.
    base: "./",
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
