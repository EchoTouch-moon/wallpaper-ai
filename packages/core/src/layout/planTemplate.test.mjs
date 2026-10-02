import assert from "node:assert/strict";
import test from "node:test";
import { generateTemplateCandidates, planTemplateCandidate } from "./planTemplate.ts";
import { getTemplate, WALLPAPER_TEMPLATES } from "./templates.ts";
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

// ---------------------------------------------------------------------------
// Registered-template safe-area avoidance (experiment finding 4): registered
// candidates scored 0.0000-0.3098 on safe-area adherence while generated
// candidates in the same scenarios scored 1.0, because the fixed slot
// geometry in templates.ts never consulted the brief's safe areas.
// ---------------------------------------------------------------------------

function pixelIntersectionArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

// Pixel rectangles — the same caliber safeAreasForBrief produces and
// evalScoring.candidateSafeAreaScore scores against.
function desktopSafeAreas(width, height) {
  return [
    {
      type: "desktop-icons-left",
      x: 0,
      y: Math.round(height * 0.05),
      width: Math.round(width * 0.18),
      height: Math.round(height * 0.82),
    },
    {
      type: "desktop-dock",
      x: Math.round(width * 0.22),
      y: Math.round(height * 0.9),
      width: Math.round(width * 0.56),
      height: Math.round(height * 0.1),
    },
  ];
}

function mobileSafeAreas(width, height) {
  return [
    {
      type: "mobile-clock",
      x: Math.round(width * 0.17),
      y: Math.round(height * 0.035),
      width: Math.round(width * 0.66),
      height: Math.round(height * 0.17),
    },
    {
      type: "mobile-widget-center",
      x: Math.round(width * 0.12),
      y: Math.round(height * 0.25),
      width: Math.round(width * 0.76),
      height: Math.round(height * 0.18),
    },
  ];
}

function assertItemsClearAndPacked(candidate, canvas, areas) {
  for (const item of candidate.layout.items) {
    assert.ok(item.x >= 0 && item.y >= 0, `${item.slotId} leaves the canvas`);
    assert.ok(
      item.x + item.width <= canvas.width + 1,
      `${item.slotId} overflows the canvas width`,
    );
    assert.ok(
      item.y + item.height <= canvas.height + 1,
      `${item.slotId} overflows the canvas height`,
    );
    for (const area of areas) {
      assert.equal(
        pixelIntersectionArea(item, area),
        0,
        `${item.slotId} intersects the ${area.type} safe area`,
      );
    }
  }
  for (let i = 0; i < candidate.layout.items.length; i += 1) {
    for (let j = i + 1; j < candidate.layout.items.length; j += 1) {
      assert.equal(
        pixelIntersectionArea(candidate.layout.items[i], candidate.layout.items[j]),
        0,
        `${candidate.layout.items[i].slotId} overlaps ${candidate.layout.items[j].slotId}`,
      );
    }
  }
}

test("registered equal triptych (desktop) insets the whole group clear of the icon column and dock", () => {
  const canvas = { width: 3840, height: 2160 };
  const candidate = planTemplateCandidate({
    analyses,
    canvasSize: canvas,
    ratioId: "16:9",
    template: getTemplate("triptych_desktop_equal"),
    templateIndex: 0,
    safeAreas: desktopSafeAreas(canvas.width, canvas.height),
  });

  assertItemsClearAndPacked(
    candidate,
    canvas,
    desktopSafeAreas(canvas.width, canvas.height),
  );
  // Equal-strip templates inset as a group, so the three columns stay equal
  // (per-slot repair would collapse only the column facing the icons).
  const widths = candidate.layout.items.map((item) => item.width);
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 8);
  const iconColumnRight = Math.round(canvas.width * 0.18);
  for (const item of candidate.layout.items) {
    assert.ok(item.x >= iconColumnRight);
  }
});

test("registered equal triptych (mobile) insets the whole group below the clock and widget bands", () => {
  const canvas = { width: 2160, height: 3840 };
  const candidate = planTemplateCandidate({
    analyses,
    canvasSize: canvas,
    ratioId: "9:16",
    template: getTemplate("triptych_mobile_equal"),
    templateIndex: 0,
    safeAreas: mobileSafeAreas(canvas.width, canvas.height),
  });

  assertItemsClearAndPacked(
    candidate,
    canvas,
    mobileSafeAreas(canvas.width, canvas.height),
  );
  const heights = candidate.layout.items.map((item) => item.height);
  assert.ok(Math.max(...heights) - Math.min(...heights) <= 8);
  // The deepest band (widget center) pushes the whole group below its bottom.
  const widgetBottom = Math.round(canvas.height * 0.43);
  for (const item of candidate.layout.items) {
    assert.ok(item.y >= widgetBottom);
  }
});

test("registered editorial template translates the hero below the mobile bands", () => {
  const canvas = { width: 2160, height: 3840 };
  const candidate = planTemplateCandidate({
    analyses,
    canvasSize: canvas,
    ratioId: "9:16",
    template: getTemplate("triptych_mobile_editorial"),
    templateIndex: 0,
    safeAreas: mobileSafeAreas(canvas.width, canvas.height),
  });

  assertItemsClearAndPacked(
    candidate,
    canvas,
    mobileSafeAreas(canvas.width, canvas.height),
  );
  const hero = candidate.layout.items.find((item) => item.role === "hero");
  assert.ok(hero, "editorial template must have a hero");
  const widgetBottom = Math.round(canvas.height * 0.43);
  assert.ok(hero.y >= widgetBottom);
  // Supports keep their lane below the hero — clearing the band never trades
  // the safe-area hit for a slot overlap.
  for (const item of candidate.layout.items) {
    if (item === hero) {
      continue;
    }
    assert.ok(item.y >= hero.y + hero.height);
  }
});

test("no safeAreas keeps registered template geometry bit-identical", () => {
  const desktop = { width: 3840, height: 2160, ratioId: "16:9" };
  const mobile = { width: 2160, height: 3840, ratioId: "9:16" };
  // The registry is shared module state — avoidance must never mutate it.
  const registrySnapshot = WALLPAPER_TEMPLATES.map((template) =>
    structuredClone(template.slots),
  );

  for (const template of WALLPAPER_TEMPLATES) {
    const canvas = template.supportedRatios.includes("16:9") ? desktop : mobile;
    const withoutAreas = planTemplateCandidate({
      analyses,
      canvasSize: { width: canvas.width, height: canvas.height },
      ratioId: canvas.ratioId,
      template,
      templateIndex: 0,
    });
    const emptyAreas = planTemplateCandidate({
      analyses,
      canvasSize: { width: canvas.width, height: canvas.height },
      ratioId: canvas.ratioId,
      template,
      templateIndex: 0,
      safeAreas: [],
    });
    // absent and empty safeAreas plan identically …
    assert.deepEqual(emptyAreas.layout.items, withoutAreas.layout.items);
    // … and both keep the exact pre-avoidance geometry: every item is the
    // template slot's direct pixel conversion.
    withoutAreas.layout.items.forEach((item, slotIndex) => {
      const slot = template.slots[slotIndex];
      assert.equal(item.x, Math.round(slot.x * canvas.width));
      assert.equal(item.y, Math.round(slot.y * canvas.height));
      assert.equal(item.width, Math.round(slot.width * canvas.width));
      assert.equal(item.height, Math.round(slot.height * canvas.height));
    });
  }

  WALLPAPER_TEMPLATES.forEach((template, index) => {
    assert.deepEqual(
      template.slots,
      registrySnapshot[index],
      `registry template ${template.id} was mutated`,
    );
  });
});
