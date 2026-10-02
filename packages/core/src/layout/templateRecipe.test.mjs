import assert from "node:assert/strict";
import test from "node:test";

import {
  CROP_ZOOM_FACTORS,
  DEFAULT_TEMPLATE_RECIPES,
  LAYERING_OVERLAP_OFFSET,
  VISUAL_WEIGHT_SLOT_SCALE,
  applyCropIntent,
  applyVisualWeight,
  compileTemplateRecipe,
  resolveCropFocus,
  templateRecipeSchema,
} from "./index.ts";

function analysis(extra = {}) {
  return {
    assetId: "asset",
    width: 2000,
    height: 1000,
    orientation: "landscape",
    aspectRatio: 2,
    resolutionScore: 0.9,
    dominantColors: ["#112233", "#223344", "#334455"],
    averageColor: "#223344",
    brightness: 0.5,
    saturation: 0.4,
    contrast: 0.4,
    ...extra,
  };
}

const COVER_CROP = {
  x: 0.25,
  y: 0,
  width: 0.5,
  height: 1,
  focalPoint: { x: 0.5, y: 0.5 },
};

const families = [
  "hero-grid",
  "balanced-mosaic",
  "triptych",
  "stacked-story",
  "layered-collage",
];

for (const ratio of [
  { id: "16:9", width: 1920, height: 1080 },
  { id: "9:19.5", width: 1290, height: 2795 },
  { id: "custom", width: 3000, height: 1200 },
]) {
  for (const family of families) {
    for (let assetCount = 2; assetCount <= 6; assetCount += 1) {
      test(`compiles ${family} for ${ratio.id} with ${assetCount} assets`, () => {
        const template = compileTemplateRecipe({
          recipe: {
            ...DEFAULT_TEMPLATE_RECIPES[1],
            family,
            supportCount: assetCount - 1,
          },
          ratioId: ratio.id,
          width: ratio.width,
          height: ratio.height,
          assetCount,
        });

        assert.equal(template.slots.length, assetCount);
        assert.equal(
          template.slots.filter((slot) => slot.role === "hero").length,
          family === "layered-collage" && assetCount === 1 ? 0 : 1,
        );
        template.slots.forEach((slot) => {
          assert.ok(slot.x >= 0);
          assert.ok(slot.y >= 0);
          assert.ok(slot.width > 0);
          assert.ok(slot.height > 0);
          assert.ok(slot.x + slot.width <= 1.00001);
          assert.ok(slot.y + slot.height <= 1.00001);
        });
      });
    }
  }
}

test("rejects unsafe recipe parameters", () => {
  assert.throws(() =>
    templateRecipeSchema.parse({
      ...DEFAULT_TEMPLATE_RECIPES[0],
      heroShare: 0.95,
    }),
  );
});

// ---------------------------------------------------------------------------
// Semantic control vocabulary (protocol v2 §2.2): schema acceptance
// ---------------------------------------------------------------------------

test("accepts the semantic control vocabulary on recipes", () => {
  const recipe = templateRecipeSchema.parse({
    ...DEFAULT_TEMPLATE_RECIPES[0],
    slotIntents: {
      hero: {
        cropIntent: { focus: "subject", zoom: "tight" },
        visualWeight: "dominant",
      },
      "support-1": { cropIntent: { focus: { x: 0.25, y: 0.75 } } },
      "support-2": { visualWeight: "subtle" },
    },
    layering: "strong",
  });

  assert.equal(recipe.slotIntents.hero.cropIntent.zoom, "tight");
  assert.equal(recipe.layering, "strong");
});

test("rejects out-of-vocabulary semantic knobs", () => {
  const base = DEFAULT_TEMPLATE_RECIPES[0];
  assert.throws(() =>
    templateRecipeSchema.parse({
      ...base,
      slotIntents: { hero: { cropIntent: { zoom: "extreme" } } },
    }),
  );
  assert.throws(() =>
    templateRecipeSchema.parse({
      ...base,
      slotIntents: { hero: { visualWeight: "huge" } },
    }),
  );
  assert.throws(() =>
    templateRecipeSchema.parse({ ...base, layering: "medium" }),
  );
  assert.throws(() =>
    templateRecipeSchema.parse({
      ...base,
      slotIntents: {
        hero: { cropIntent: { focus: { x: 1.5, y: 0.5 } } },
      },
    }),
  );
});

// ---------------------------------------------------------------------------
// cropIntent.focus → focal point mapping
// ---------------------------------------------------------------------------

test("focus subject resolves to the analyzed subject box center", () => {
  const focal = resolveCropFocus(
    "subject",
    analysis({ subjectBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.4 } }),
  );
  assert.deepEqual(focal, { x: 0.7, y: 0.4 });
});

test("focus subject falls back to saliency then the image center", () => {
  assert.deepEqual(
    resolveCropFocus("subject", analysis({ saliencyCenter: { x: 0.3, y: 0.6 } })),
    { x: 0.3, y: 0.6 },
  );
  assert.deepEqual(resolveCropFocus("subject", analysis()), { x: 0.5, y: 0.5 });
});

test("focus saliency resolves to the analyzed saliency center", () => {
  assert.deepEqual(
    resolveCropFocus(
      "saliency",
      analysis({
        saliencyCenter: { x: 0.3, y: 0.6 },
        subjectBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.4 },
      }),
    ),
    { x: 0.3, y: 0.6 },
  );
  // falls back to the subject box center, then the image center
  assert.deepEqual(
    resolveCropFocus(
      "saliency",
      analysis({ subjectBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.4 } }),
    ),
    { x: 0.7, y: 0.4 },
  );
  assert.deepEqual(resolveCropFocus("saliency", analysis()), { x: 0.5, y: 0.5 });
});

test("focus center and custom normalized points map directly", () => {
  assert.deepEqual(resolveCropFocus("center", analysis()), { x: 0.5, y: 0.5 });
  assert.deepEqual(
    resolveCropFocus({ x: 0.25, y: 0.75 }, analysis()),
    { x: 0.25, y: 0.75 },
  );
});

// ---------------------------------------------------------------------------
// cropIntent.zoom → crop box scale factor, clamped to the legal domain
// ---------------------------------------------------------------------------

test("zoom tiers scale the crop box around the focal point", () => {
  const tight = applyCropIntent(
    COVER_CROP,
    { focus: "center", zoom: "tight" },
    analysis(),
  );
  assert.equal(tight.width, COVER_CROP.width * CROP_ZOOM_FACTORS.tight);
  assert.equal(tight.height, COVER_CROP.height * CROP_ZOOM_FACTORS.tight);
  assert.equal(tight.x, 0.5 - tight.width / 2);
  assert.equal(tight.y, 0.5 - tight.height / 2);
  assert.deepEqual(tight.focalPoint, { x: 0.5, y: 0.5 });

  const loose = applyCropIntent(
    COVER_CROP,
    { focus: "center", zoom: "loose" },
    analysis(),
  );
  assert.equal(loose.width, COVER_CROP.width * CROP_ZOOM_FACTORS.loose);
  // height is already 1 and cannot grow past the source image
  assert.equal(loose.height, 1);
  assert.equal(loose.y, 0);
});

test("zoom clamps edge-focused crops back into the legal domain", () => {
  const topLeft = applyCropIntent(
    COVER_CROP,
    { focus: { x: 0, y: 0 }, zoom: "tight" },
    analysis(),
  );
  assert.equal(topLeft.x, 0);
  assert.equal(topLeft.y, 0);

  const bottomRight = applyCropIntent(
    COVER_CROP,
    { focus: { x: 1, y: 1 }, zoom: "tight" },
    analysis(),
  );
  assert.equal(bottomRight.x, 1 - bottomRight.width);
  assert.equal(bottomRight.y, 1 - bottomRight.height);

  for (const crop of [topLeft, bottomRight]) {
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= 1 && crop.y + crop.height <= 1);
  }
});

test("an inert crop intent leaves the base cover crop untouched", () => {
  assert.equal(
    applyCropIntent(COVER_CROP, { zoom: "standard" }, analysis()),
    null,
  );
  assert.equal(applyCropIntent(COVER_CROP, {}, analysis()), null);
});

// ---------------------------------------------------------------------------
// visualWeight → slot scale tier
// ---------------------------------------------------------------------------

test("visual weight tiers scale slots around their center", () => {
  const rect = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
  const dominant = applyVisualWeight(rect, "dominant");
  assert.equal(dominant.width, rect.width * VISUAL_WEIGHT_SLOT_SCALE.dominant);
  assert.equal(dominant.x, 0.4 - dominant.width / 2);

  const subtle = applyVisualWeight(rect, "subtle");
  assert.equal(subtle.width, rect.width * VISUAL_WEIGHT_SLOT_SCALE.subtle);
  assert.equal(subtle.width < rect.width, true);

  assert.deepEqual(applyVisualWeight(rect, "balanced"), rect);
});

test("visual weight clamps grown slots back onto the canvas", () => {
  // A full-bleed slot cannot grow past the canvas.
  assert.deepEqual(
    applyVisualWeight({ x: 0, y: 0, width: 1, height: 1 }, "dominant"),
    { x: 0, y: 0, width: 1, height: 1 },
  );

  // A slot hugging the right edge shifts left instead of leaving the canvas.
  const grown = applyVisualWeight(
    { x: 0.9, y: 0, width: 0.1, height: 0.1 },
    "dominant",
  );
  assert.ok(Math.abs(grown.width - 0.108) < 1e-9);
  assert.equal(grown.x, 1 - grown.width);
  assert.ok(grown.x + grown.width <= 1);
});

// ---------------------------------------------------------------------------
// compileTemplateRecipe consumes the knobs
// ---------------------------------------------------------------------------

const LANDSCAPE = { id: "16:9", width: 1920, height: 1080 };

function heroSlotOf(template) {
  return template.slots.find((slot) => slot.role === "hero");
}

function compileHeroGrid(overrides = {}) {
  return compileTemplateRecipe({
    recipe: { ...DEFAULT_TEMPLATE_RECIPES[0], ...overrides.recipe },
    ratioId: LANDSCAPE.id,
    width: LANDSCAPE.width,
    height: LANDSCAPE.height,
    assetCount: 3,
    ...overrides.input,
  });
}

test("cropIntent compiles into a focal crop on the bound slot", () => {
  const assets = [
    analysis({ subjectBox: { x: 0.6, y: 0.2, width: 0.2, height: 0.4 } }),
  ];
  const template = compileHeroGrid({
    recipe: {
      slotIntents: { hero: { cropIntent: { focus: "subject" } } },
    },
    input: {
      assets,
      slotAssignments: { hero: "asset" },
    },
  });
  const hero = heroSlotOf(template);

  assert.deepEqual(hero.crop.focalPoint, { x: 0.7, y: 0.4 });
  assert.ok(hero.crop.x >= 0 && hero.crop.y >= 0);
  assert.ok(hero.crop.x + hero.crop.width <= 1);
  assert.ok(hero.crop.y + hero.crop.height <= 1);
  // the crop box covers the resolved focal point
  assert.ok(hero.crop.x <= 0.7 && 0.7 <= hero.crop.x + hero.crop.width);
});

test("cropIntent without an asset binding leaves slots crop-free", () => {
  const template = compileHeroGrid({
    recipe: {
      slotIntents: { hero: { cropIntent: { focus: "subject" } } },
    },
  });
  assert.equal(heroSlotOf(template).crop, undefined);
});

test("visualWeight scales the compiled slot within the canvas", () => {
  const base = compileHeroGrid();
  const baseHero = heroSlotOf(base);

  const dominant = compileHeroGrid({
    recipe: {
      slotIntents: { hero: { visualWeight: "dominant" } },
    },
  }).slots.find((slot) => slot.role === "hero");
  assert.ok(dominant.width > baseHero.width);
  assert.ok(dominant.height >= baseHero.height);
  assert.ok(dominant.x >= 0 && dominant.x + dominant.width <= 1);
  assert.ok(dominant.y >= 0 && dominant.y + dominant.height <= 1);
  // scale keeps the slot centered
  assert.ok(
    Math.abs(
      dominant.x + dominant.width / 2 - (baseHero.x + baseHero.width / 2),
    ) < 1e-4,
  );

  const subtle = compileHeroGrid({
    recipe: { slotIntents: { hero: { visualWeight: "subtle" } } },
  }).slots.find((slot) => slot.role === "hero");
  assert.ok(subtle.width < baseHero.width && subtle.height < baseHero.height);
});

test("layering offsets dynamic layered-collage supports, clamped to bounds", () => {
  const compileLayered = (layering, profile = "dynamic") =>
    compileTemplateRecipe({
      recipe: {
        ...DEFAULT_TEMPLATE_RECIPES[2],
        supportCount: 3,
        ...(layering ? { layering } : {}),
        ...(profile ? { profile } : {}),
      },
      ratioId: LANDSCAPE.id,
      width: LANDSCAPE.width,
      height: LANDSCAPE.height,
      assetCount: 4,
    });
  const supportsOf = (template) =>
    template.slots.filter((slot) => slot.role === "support");

  const base = supportsOf(compileLayered(null));
  const slight = supportsOf(compileLayered("slight"));
  const strong = supportsOf(compileLayered("strong"));
  const none = supportsOf(compileLayered("none"));

  // slight is the current default: byte-identical geometry
  assert.deepEqual(slight, base);

  // strong pulls supports toward the hero by the mapping offset
  const offset = LAYERING_OVERLAP_OFFSET.strong;
  strong.forEach((slot, index) => {
    assert.ok(Math.abs(slot.x - (base[index].x + offset)) < 1e-5);
  });

  // none pushes them away; the rightmost position clamps at the content edge
  const content = { x: 0.025, width: 0.95 };
  none.forEach((slot, index) => {
    const unclamped = base[index].x + LAYERING_OVERLAP_OFFSET.none;
    const expected = Math.min(unclamped, content.x + content.width - slot.width);
    assert.ok(Math.abs(slot.x - expected) < 1e-5);
    assert.ok(slot.x + slot.width <= 1.00001);
  });

  // only the dynamic recipe family consumes layering: the same strong
  // layering on a non-dynamic profile compiles exactly like no layering
  const editorialWithout = supportsOf(compileLayered(null, "editorial"));
  const editorialWith = supportsOf(compileLayered("strong", "editorial"));
  assert.deepEqual(editorialWith, editorialWithout);
});

// ---------------------------------------------------------------------------
// Default identity: absent (or inert) knobs compile byte-identically
// ---------------------------------------------------------------------------

test("absent or inert semantic knobs compile byte-identically", () => {
  for (const ratio of [
    { id: "16:9", width: 1920, height: 1080 },
    { id: "9:19.5", width: 1290, height: 2795 },
    { id: "custom", width: 3000, height: 1200 },
  ]) {
    for (const family of families) {
      for (let assetCount = 2; assetCount <= 6; assetCount += 1) {
        const base = {
          ...DEFAULT_TEMPLATE_RECIPES[1],
          family,
          supportCount: assetCount - 1,
        };
        const inert = {
          ...base,
          slotIntents: {
            hero: { visualWeight: "balanced", cropIntent: { zoom: "standard" } },
            "support-1": { visualWeight: "balanced" },
          },
          layering: "slight",
        };

        const withoutKnobs = compileTemplateRecipe({
          recipe: base,
          ratioId: ratio.id,
          width: ratio.width,
          height: ratio.height,
          assetCount,
        });
        const withInertKnobs = compileTemplateRecipe({
          recipe: inert,
          ratioId: ratio.id,
          width: ratio.width,
          height: ratio.height,
          assetCount,
        });
        const stripped = compileTemplateRecipe({
          recipe: {
            ...base,
            slotIntents: {
              hero: { cropIntent: { focus: "subject", zoom: "loose" } },
            },
            layering: "strong",
          },
          ratioId: ratio.id,
          width: ratio.width,
          height: ratio.height,
          assetCount,
          assets: [analysis({ subjectBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } })],
          slotAssignments: { hero: "asset" },
        });
        const strippedBase = compileTemplateRecipe({
          recipe: base,
          ratioId: ratio.id,
          width: ratio.width,
          height: ratio.height,
          assetCount,
          assets: [analysis()],
          slotAssignments: { hero: "asset" },
        });

        // inert knobs change nothing
        assert.deepEqual(withInertKnobs, withoutKnobs);
        // stripping the optional fields from a knob-bearing recipe restores
        // the default compilation exactly (except the new fields themselves)
        assert.deepEqual(
          stripped.slots.map(({ crop, ...slot }) => slot),
          strippedBase.slots,
        );
        assert.equal(strippedBase.slots.every((slot) => slot.crop === undefined), true);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Safe-area avoidance (experiment findings 3/4)
// ---------------------------------------------------------------------------

function intersectionArea(a, b) {
  const width =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

// Pixel rectangles — the same caliber `safeAreasForBrief` produces and
// `evalScoring.candidateSafeAreaScore` scores against.
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

function dockSafeArea(width, height) {
  return {
    type: "desktop-dock",
    x: Math.round(width * 0.22),
    y: Math.round(height * 0.9),
    width: Math.round(width * 0.56),
    height: Math.round(height * 0.1),
  };
}

function normalizedAreas(areas, width, height) {
  return areas.map((area) => ({
    x: area.x / width,
    y: area.y / height,
    width: area.width / width,
    height: area.height / height,
  }));
}

function assertSlotsClearAndPacked(template, areas) {
  for (const slot of template.slots) {
    assert.ok(slot.x >= 0 && slot.y >= 0);
    assert.ok(slot.x + slot.width <= 1.00001);
    assert.ok(slot.y + slot.height <= 1.00001);
    for (const area of areas) {
      assert.equal(
        intersectionArea(slot, area),
        0,
        `${slot.id} intersects the ${area.type ?? "safe"} area`,
      );
    }
  }
  for (let i = 0; i < template.slots.length; i += 1) {
    for (let j = i + 1; j < template.slots.length; j += 1) {
      assert.equal(
        intersectionArea(template.slots[i], template.slots[j]),
        0,
        `${template.slots[i].id} overlaps ${template.slots[j].id}`,
      );
    }
  }
}

const MOBILE = { id: "9:16", width: 2160, height: 3840 };

test("mobile safe areas: bottom hero clears the clock and widget bands", () => {
  const areas = mobileSafeAreas(MOBILE.width, MOBILE.height);
  const template = compileTemplateRecipe({
    recipe: {
      ...DEFAULT_TEMPLATE_RECIPES[0],
      heroPosition: "bottom",
      margin: 0.25,
      supportCount: 2,
    },
    ratioId: MOBILE.id,
    width: MOBILE.width,
    height: MOBILE.height,
    assetCount: 3,
    safeAreas: areas,
  });

  const normalized = normalizedAreas(areas, MOBILE.width, MOBILE.height);
  assertSlotsClearAndPacked(template, normalized);

  // the hero starts below the widget band's bottom edge …
  const widgetBottom =
    normalized[1].y + normalized[1].height;
  const hero = heroSlotOf(template);
  assert.ok(hero.y >= widgetBottom - 1e-6);
  // … and stays pinned to the bottom of the content rect
  const contentBottom = 1 - 0.25 - 0.005;
  assert.ok(Math.abs(hero.y + hero.height - contentBottom) < 1e-5);
});

test("mobile safe areas: a top hero translates below the band without covering supports", () => {
  const areas = mobileSafeAreas(MOBILE.width, MOBILE.height);
  const template = compileTemplateRecipe({
    recipe: {
      ...DEFAULT_TEMPLATE_RECIPES[0],
      heroPosition: "top",
      supportCount: 2,
    },
    ratioId: MOBILE.id,
    width: MOBILE.width,
    height: MOBILE.height,
    assetCount: 3,
    safeAreas: areas,
  });

  const normalized = normalizedAreas(areas, MOBILE.width, MOBILE.height);
  assertSlotsClearAndPacked(template, normalized);

  // the hero moved below the deepest band bottom (widget band) …
  const widgetBottom = normalized[1].y + normalized[1].height;
  const hero = heroSlotOf(template);
  assert.ok(hero.y >= widgetBottom - 1e-6);
  // … and supports still sit below the hero without being shoved around
  for (const slot of template.slots) {
    if (slot.role === "hero") {
      continue;
    }
    assert.ok(slot.y >= hero.y + hero.height - 1e-6);
  }
});

test("desktop dock caps slot heights at the dock's top edge", () => {
  const dock = dockSafeArea(LANDSCAPE.width, LANDSCAPE.height);
  const template = compileTemplateRecipe({
    recipe: { ...DEFAULT_TEMPLATE_RECIPES[0], supportCount: 3 },
    ratioId: LANDSCAPE.id,
    width: LANDSCAPE.width,
    height: LANDSCAPE.height,
    assetCount: 4,
    safeAreas: [dock],
  });

  const normalized = normalizedAreas([dock], LANDSCAPE.width, LANDSCAPE.height)[0];
  assertSlotsClearAndPacked(template, [normalized]);

  // every slot horizontally overlapping the dock respects the height cap
  const dockTop = dock.y / LANDSCAPE.height;
  for (const slot of template.slots) {
    const horizontalOverlap =
      Math.min(slot.x + slot.width, normalized.x + normalized.width) -
      Math.max(slot.x, normalized.x);
    if (horizontalOverlap > 0) {
      assert.ok(
        slot.y + slot.height <= dockTop + 1e-6,
        `${slot.id} extends into the dock strip`,
      );
    }
  }
});

test("desktop icon column shrinks the facing slot edge clear of the column", () => {
  const width = LANDSCAPE.width;
  const height = LANDSCAPE.height;
  const iconsLeft = {
    type: "desktop-icons-left",
    x: 0,
    y: Math.round(height * 0.05),
    width: Math.round(width * 0.18),
    height: Math.round(height * 0.82),
  };
  const template = compileTemplateRecipe({
    recipe: { ...DEFAULT_TEMPLATE_RECIPES[0], heroPosition: "left", supportCount: 1 },
    ratioId: LANDSCAPE.id,
    width,
    height,
    assetCount: 2,
    safeAreas: [iconsLeft],
  });

  const normalized = normalizedAreas([iconsLeft], width, height)[0];
  assertSlotsClearAndPacked(template, [normalized]);
  // the left-aligned hero was pushed right of the icon column
  const hero = heroSlotOf(template);
  assert.ok(hero.x >= normalized.x + normalized.width - 1e-6);
});

test("balanced-mosaic respects heroPosition: left pins the hero to the edge", () => {
  const template = compileTemplateRecipe({
    recipe: {
      ...DEFAULT_TEMPLATE_RECIPES[1],
      heroPosition: "left",
      supportCount: 2,
    },
    ratioId: LANDSCAPE.id,
    width: LANDSCAPE.width,
    height: LANDSCAPE.height,
    assetCount: 3,
  });

  const hero = heroSlotOf(template);
  const inset = DEFAULT_TEMPLATE_RECIPES[1].margin; // soft-avoid keeps the plain margin
  // hero hugs the content's left edge at full height …
  assert.ok(Math.abs(hero.x - inset) < 1e-5);
  assert.ok(Math.abs(hero.y - inset) < 1e-5);
  assert.ok(Math.abs(hero.height - (1 - inset * 2)) < 1e-5);
  // … with the heroShare width …
  const contentWidth = 1 - inset * 2;
  assert.ok(Math.abs(hero.width - 0.48 * contentWidth) < 1e-5);
  // … and every support stacked on the opposite side
  for (const slot of template.slots) {
    if (slot.role === "hero") {
      continue;
    }
    assert.ok(
      slot.x >= hero.x + hero.width + DEFAULT_TEMPLATE_RECIPES[1].gap - 1e-5,
    );
  }
  assertSlotsClearAndPacked(template, []);
});

test("default compile is unchanged without safe areas", () => {
  const input = (extra) => ({
    recipe: { ...DEFAULT_TEMPLATE_RECIPES[1], supportCount: 3 },
    ratioId: LANDSCAPE.id,
    width: LANDSCAPE.width,
    height: LANDSCAPE.height,
    assetCount: 4,
    ...extra,
  });
  // absent and empty safeAreas compile identically …
  assert.deepEqual(
    compileTemplateRecipe(input({ safeAreas: [] })),
    compileTemplateRecipe(input()),
  );
  // … and the centered mosaic keeps its centered-hero geometry
  const template = compileTemplateRecipe(input());
  const hero = heroSlotOf(template);
  const inset = DEFAULT_TEMPLATE_RECIPES[1].margin;
  const leftGap = hero.x - inset;
  const rightGap = 1 - inset - (hero.x + hero.width);
  assert.ok(Math.abs(leftGap - rightGap) < 1e-5);
  assert.ok(leftGap > 0.1);
});

test("recipes accept the bottom hero position and the mobile margin floor", () => {
  const recipe = templateRecipeSchema.parse({
    ...DEFAULT_TEMPLATE_RECIPES[0],
    heroPosition: "bottom",
    margin: 0.25,
  });
  assert.equal(recipe.heroPosition, "bottom");
  assert.equal(recipe.margin, 0.25);
});

test("strip slot IDs stay contiguous across the hero position (planner contract)", () => {
  // The planner prompt fixes generated slot IDs as "hero, support-1 onward";
  // a portrait strip must not skip the support number the hero occupies
  // (support-1, hero, support-2 — never support-3, which no model assigns).
  for (const family of ["stacked-story", "triptych"]) {
    for (const assetCount of [3, 4, 5]) {
      const template = compileTemplateRecipe({
        recipe: {
          ...DEFAULT_TEMPLATE_RECIPES[1],
          family,
          supportCount: assetCount - 1,
        },
        ratioId: "9:16",
        width: 2160,
        height: 3840,
        assetCount,
        safeAreas: [],
      });
      const ids = template.slots.map((slot) => slot.id);
      const supports = ids
        .filter((id) => id.startsWith("support-"))
        .map((id) => Number(id.slice("support-".length)))
        .sort((a, b) => a - b);
      assert.deepEqual(
        supports,
        Array.from({ length: supports.length }, (_, index) => index + 1),
        `${family} with ${assetCount} assets must use contiguous support IDs (got ${ids.join(", ")})`,
      );
      assert.equal(ids.filter((id) => id === "hero").length, 1);
    }
  }
});
