import assert from "node:assert/strict";
import test from "node:test";
import {
  editorProjectSchema,
  wallpaperLayoutSchema,
} from "./layoutSchema.ts";
import { validateLayout } from "./validateLayout.ts";

const validLayout = {
  version: "1.0",
  canvas: {
    width: 1920,
    height: 1080,
    ratio: "16:9",
    usage: "desktop",
    backgroundColor: "#f4f3ed",
  },
  template: { id: "triptych_desktop_equal", type: "triptych" },
  items: [
    {
      id: "item_1",
      assetId: "asset_1",
      role: "hero",
      x: 0,
      y: 0,
      width: 640,
      height: 1080,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      fit: "cover",
      crop: { x: 0, y: 0, width: 1, height: 1 },
    },
  ],
  safeAreas: [],
  guidance: {
    intent: "balanced-collage",
    visualFlow: "left-to-right",
    transition: { type: "clean-gap", strength: 0.2, feather: 0 },
    boundary: { type: "clean-gap", gap: 24, radius: 0, width: 0 },
    preserveFaces: true,
    preserveNegativeSpace: true,
  },
  notes: [],
};

test("accepts a canonical wallpaper layout", () => {
  assert.equal(wallpaperLayoutSchema.safeParse(validLayout).success, true);
});

test("rejects duplicate item ids", () => {
  const duplicate = {
    ...validLayout,
    items: [validLayout.items[0], { ...validLayout.items[0] }],
  };
  assert.equal(wallpaperLayoutSchema.safeParse(duplicate).success, false);
});

test("rejects crop rectangles outside normalized bounds", () => {
  const invalidCrop = structuredClone(validLayout);
  invalidCrop.items[0].crop = { x: 0.8, y: 0, width: 0.4, height: 1 };
  assert.equal(wallpaperLayoutSchema.safeParse(invalidCrop).success, false);
});

test("rejects unknown assets, templates, and out-of-canvas geometry", () => {
  const invalid = structuredClone(validLayout);
  invalid.items[0].x = 1700;
  const result = validateLayout(invalid, {
    assetIds: ["different_asset"],
    templateIds: ["different_template"],
  });
  assert.equal(result.success, false);
  assert.match(result.error.message, /Unknown template/);
  assert.match(result.error.message, /Unknown asset/);
  assert.match(result.error.message, /outside the canvas/);
});

test("rejects project layouts that reference missing assets", () => {
  const result = editorProjectSchema.safeParse({
    version: "1.0",
    id: "local-draft",
    name: "Draft",
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:01.000Z",
    ratioId: "16:9",
    assetIds: [],
    analyses: [],
    candidates: [],
    currentLayout: validLayout,
  });

  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /unknown asset/i);
});
