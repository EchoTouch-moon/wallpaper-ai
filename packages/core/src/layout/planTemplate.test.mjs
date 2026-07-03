import assert from "node:assert/strict";
import test from "node:test";
import { generateTemplateCandidates } from "./planTemplate.ts";
import { WALLPAPER_TEMPLATES } from "./templates.ts";
import { validateLayout } from "./validateLayout.ts";

function analysis(assetId, averageColor, orientation = "landscape") {
  const dimensions =
    orientation === "portrait"
      ? { width: 1200, height: 1800 }
      : { width: 1920, height: 1080 };

  return {
    assetId,
    ...dimensions,
    orientation,
    aspectRatio: dimensions.width / dimensions.height,
    resolutionScore: assetId === "hero" ? 0.95 : 0.78,
    dominantColors: [averageColor, averageColor, averageColor],
    averageColor,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
    bestUse: assetId === "hero" ? ["hero", "background"] : ["support"],
  };
}

const analyses = [
  analysis("hero", "#456fd6"),
  analysis("support_a", "#5278d8", "portrait"),
  analysis("support_b", "#3e64c0"),
  analysis("support_c", "#678adf", "portrait"),
];

test("plans non-triptych templates through the shared template pipeline", () => {
  const templates = WALLPAPER_TEMPLATES.filter(
    (template) =>
      template.supportedRatios.includes("16:9") &&
      template.type !== "triptych",
  );
  const candidates = generateTemplateCandidates(
    analyses,
    { width: 1920, height: 1080 },
    "16:9",
    templates,
    "balanced-collage",
  );

  assert.ok(candidates.length >= 2);
  assert.ok(
    candidates.every((candidate) => candidate.layout.template.type !== "triptych"),
  );

  candidates.forEach((candidate) => {
    const result = validateLayout(candidate.layout, {
      assetIds: analyses.map((item) => item.assetId),
      templateIds: templates.map((template) => template.id),
    });
    assert.equal(result.success, true);
    assert.ok(candidate.layout.items.length >= 3);
  });
});
