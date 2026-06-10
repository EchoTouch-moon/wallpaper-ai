import assert from "node:assert/strict";
import test from "node:test";
import { handleGenerateLayoutRequest } from "../../../lib/layout-generation/handleGenerateLayoutRequest.ts";

function analysis(assetId, averageColor) {
  return {
    assetId,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 1920 / 1080,
    resolutionScore: 0.8,
    dominantColors: [averageColor, averageColor, averageColor],
    averageColor,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const requestBody = {
  canvas: { width: 1920, height: 1080, ratioId: "16:9" },
  intent: { mode: "mock-ai", style: "auto", count: 3 },
  assets: [
    analysis("asset_a", "#456fd6"),
    analysis("asset_b", "#5278d8"),
    analysis("asset_c", "#3e64c0"),
  ],
};

test("generate-layout API returns candidates for a valid request", async () => {
  const response = handleGenerateLayoutRequest(requestBody);

  assert.equal(response.status, 200);
  assert.equal(response.body.source, "mock-ai");
  assert.equal(response.body.candidates.length, 3);
});

test("generate-layout API returns 400 for invalid requests", async () => {
  const response = handleGenerateLayoutRequest({
    ...requestBody,
    intent: { ...requestBody.intent, mode: "invalid" },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "Invalid generate-layout request");
  assert.ok(response.body.issues.length > 0);
});
