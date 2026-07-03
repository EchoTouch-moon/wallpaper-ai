import assert from "node:assert/strict";
import test from "node:test";
import { createProjectSnapshot } from "./projectSnapshot.ts";

test("creates a schema-valid local draft without object URLs", () => {
  const analysis = {
    assetId: "asset_1",
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 16 / 9,
    resolutionScore: 0.8,
    dominantColors: ["#112233", "#223344", "#334455"],
    averageColor: "#223344",
    brightness: 0.4,
    saturation: 0.5,
    contrast: 0.3,
  };
  const project = createProjectSnapshot({
    createdAt: "2026-06-07T00:00:00.000Z",
    now: "2026-06-07T00:00:01.000Z",
    ratioId: "16:9",
    assets: [{
      id: "asset_1",
      name: "photo.jpg",
      objectUrl: "blob:temporary",
      thumbnailUrl: "blob:temporary",
      mimeType: "image/jpeg",
      width: 1920,
      height: 1080,
      aspectRatio: 16 / 9,
      analysis,
      metadata: {
        orientation: "landscape",
        quality: 0.8,
        dominantColors: analysis.dominantColors,
      },
    }],
    candidates: [],
    candidateSource: null,
    layoutSession: null,
    currentLayout: null,
  });

  assert.deepEqual(project.assetIds, ["asset_1"]);
  assert.equal(JSON.stringify(project).includes("blob:temporary"), false);
});
