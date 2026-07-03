/**
 * @wallpaper/core — shared core for wallpaper-ai web and desktop apps.
 *
 * Subpath imports are preferred for tree-shaking:
 *   import { swapLayoutItemAssets } from "@wallpaper/core/layout";
 *   import { generateLayouts } from "@wallpaper/core/layout-generation";
 *
 * This barrel re-exports types and the most-used runtime helpers.
 * To avoid name collisions between modules, prefer subpath imports
 * for anything not listed here.
 */

// Types are the single source of truth for shared type names.
export * from "./types/index.ts";

// Runtime helpers (no name overlap with types module).
export * from "./wallpaper/index.ts";
export * from "./editor/index.ts";
