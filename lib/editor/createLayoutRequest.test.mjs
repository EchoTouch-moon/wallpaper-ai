import assert from "node:assert/strict";
import test from "node:test";

import { createEditorLayoutRequest } from "./createLayoutRequest.ts";

const analysis = {
  assetId: "asset_a",
  width: 1920,
  height: 1080,
  orientation: "landscape",
  aspectRatio: 1920 / 1080,
  resolutionScore: 0.9,
  dominantColors: ["#456fd6", "#5278d8", "#3e64c0"],
  averageColor: "#456fd6",
  brightness: 0.5,
  saturation: 0.5,
  contrast: 0.4,
};

const currentLayout = {
  version: "1.0",
  canvas: {
    width: 1920,
    height: 1080,
    ratio: "16:9",
    usage: "desktop",
    backgroundColor: "#ffffff",
  },
  items: [],
  safeAreas: [],
  guidance: {
    intent: "balanced-collage",
    visualFlow: "left-to-right",
    transition: { type: "clean-gap", strength: 0.2, feather: 0 },
    boundary: { type: "clean-gap", gap: 24, radius: 0, width: 1 },
    preserveFaces: true,
    preserveNegativeSpace: true,
  },
  notes: [],
};

test("builds a three-candidate generation request without current layout", () => {
  const request = createEditorLayoutRequest({
    operation: "generate",
    mode: "ai",
    canvasSize: { width: 1920, height: 1080 },
    ratioId: "16:9",
    compositionIntent: "balanced-collage",
    assets: [analysis],
    currentLayout,
  });

  assert.equal(request.intent.count, 3);
  assert.equal(request.currentLayout, undefined);
  assert.equal(request.intent.userPrompt, undefined);
});

test("builds a single-candidate refine request with trimmed instruction", () => {
  const request = createEditorLayoutRequest({
    operation: "refine",
    mode: "ai",
    canvasSize: { width: 1920, height: 1080 },
    ratioId: "16:9",
    compositionIntent: "balanced-collage",
    assets: [analysis],
    currentLayout,
    userPrompt: "  make the hero larger  ",
  });

  assert.equal(request.intent.count, 1);
  assert.equal(request.options.candidateCount, 1);
  assert.equal(request.currentLayout, currentLayout);
  assert.equal(request.intent.userPrompt, "make the hero larger");
});
