import assert from "node:assert/strict";
import test from "node:test";
import { generateLayouts } from "./generateLayouts.ts";
import { generateLayoutRequestSchema } from "./schema.ts";

function analysis(assetId, averageColor, orientation = "landscape", extra = {}) {
  const dimensions =
    orientation === "portrait"
      ? { width: 1200, height: 1800 }
      : { width: 1920, height: 1080 };

  return {
    assetId,
    ...dimensions,
    orientation,
    aspectRatio: dimensions.width / dimensions.height,
    resolutionScore: 0.8,
    dominantColors: [averageColor, averageColor, averageColor],
    averageColor,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
    ...extra,
  };
}

const baseRequest = {
  canvas: { width: 1920, height: 1080, ratioId: "16:9" },
  intent: {
    mode: "mock-ai",
    style: "auto",
    compositionIntent: "balanced-collage",
    count: 3,
  },
  assets: [
    analysis("asset_a", "#456fd6"),
    analysis("asset_b", "#5278d8"),
    analysis("asset_c", "#3e64c0", "portrait"),
    analysis("asset_d", "#678adf"),
  ],
  options: { candidateCount: 3, allowFallback: true, strictValidation: true },
};

test("validates generate layout request shape", () => {
  assert.equal(generateLayoutRequestSchema.safeParse(baseRequest).success, true);
  assert.equal(
    generateLayoutRequestSchema.safeParse({
      ...baseRequest,
      intent: { ...baseRequest.intent, mode: "unknown" },
    }).success,
    false,
  );
  assert.equal(
    generateLayoutRequestSchema.safeParse({
      ...baseRequest,
      assets: baseRequest.assets.slice(0, 2),
    }).success,
    false,
  );
});

test("generates mock-ai candidates through orchestration", () => {
  const response = generateLayouts(baseRequest);

  assert.equal(response.source, "mock-ai");
  assert.equal(response.rejected.length, 0);
  assert.equal(response.candidates.length, 3);
  response.candidates.forEach((candidate) => {
    assert.equal(candidate.layout.canvas.ratio, "16:9");
  });
});

test("template mode respects requested style", () => {
  const response = generateLayouts({
    ...baseRequest,
    intent: {
      ...baseRequest.intent,
      mode: "template",
      style: "layered-moodboard",
    },
  });

  assert.equal(response.source, "template");
  assert.ok(response.candidates.length > 0);
  assert.ok(
    response.candidates.every(
      (candidate) => candidate.layout.template.type === "layered-moodboard",
    ),
  );
});

test("ai mode returns mock fallback with warning for now", () => {
  const response = generateLayouts({
    ...baseRequest,
    intent: { ...baseRequest.intent, mode: "ai" },
  });

  assert.equal(response.source, "fallback");
  assert.ok(response.warnings?.[0].includes("AI mode is not connected"));
  assert.equal(response.candidates.length, 3);
});

test("mock-ai prioritizes portrait templates for portrait signals", () => {
  const response = generateLayouts({
    ...baseRequest,
    canvas: { width: 1080, height: 1920, ratioId: "9:16" },
    assets: [
      analysis("portrait_a", "#456fd6", "portrait", {
        contentType: "portrait",
        faces: [{ x: 0.3, y: 0.1, width: 0.3, height: 0.3 }],
      }),
      analysis("portrait_b", "#5278d8", "portrait", {
        contentType: "portrait",
      }),
      analysis("portrait_c", "#3e64c0", "portrait"),
    ],
  });

  assert.equal(response.candidates[0].layout.template.type, "portrait-triptych");
});
