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
// Ref: P1 Windows verification (error 3 & 5).
const mainExternal = ["electron"];
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
