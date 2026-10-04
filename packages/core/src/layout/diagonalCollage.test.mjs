import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TEMPLATE_RECIPES,
  compileTemplateRecipe,
  getTemplate,
  planDiagonalCollageSlots,
  planTemplateCandidate,
  templateRecipeSchema,
} from "./index.ts";
import {
  wallpaperItemSchema,
  wallpaperLayoutSchema,
} from "./layoutSchema.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PORTRAIT = { id: "9:16", width: 1290, height: 2795 };

function diagonalRecipe(overrides = {}) {
  return {
    ...DEFAULT_TEMPLATE_RECIPES[1],
    family: "diagonal-collage",
    supportCount: 3,
    ...overrides,
  };
}

function compileDiagonal({
  assetCount = 5,
  recipe = {},
  ratio = PORTRAIT,
} = {}) {
  return compileTemplateRecipe({
    recipe: diagonalRecipe(recipe),
    ratioId: ratio.id,
    width: ratio.width,
    height: ratio.height,
    assetCount,
  });
}

function analysis(assetId, orientation = "landscape") {
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
    dominantColors: ["#456fd6", "#5278d8", "#3e64c0"],
    averageColor: "#456fd6",
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const fiveAnalyses = [
  analysis("hero", "portrait"),
  analysis("support_a", "portrait"),
  analysis("support_b"),
  analysis("support_c", "portrait"),
  analysis("support_d"),
];

function supportsOf(template) {
  return template.slots.filter((slot) => slot.role === "support");
}

function heroesOf(template) {
  return template.slots.filter((slot) => slot.role === "hero");
}

function intersectionArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function assertSlotsInsideCanvas(template) {
  for (const slot of template.slots) {
    assert.ok(slot.x >= 0 && slot.y >= 0, `${slot.id} leaves the canvas`);
    assert.ok(slot.width > 0 && slot.height > 0, `${slot.id} is degenerate`);
    assert.ok(slot.x + slot.width <= 1.00001, `${slot.id} overflows x`);
    assert.ok(slot.y + slot.height <= 1.00001, `${slot.id} overflows y`);
  }
}

// ---------------------------------------------------------------------------
// treatment 枚举校验（recipe 槽位 + 布局图片槽）
// ---------------------------------------------------------------------------

test("slotIntent treatment defaults to crop and accepts the vocabulary", () => {
  const parsed = templateRecipeSchema.parse({
    ...diagonalRecipe(),
    slotIntents: {
      hero: { treatment: "cutout" },
      "support-1": { treatment: "full" },
      "support-2": {},
    },
  });
  assert.equal(parsed.slotIntents.hero.treatment, "cutout");
  assert.equal(parsed.slotIntents["support-1"].treatment, "full");
  // absent treatment parses to the default
  assert.equal(parsed.slotIntents["support-2"].treatment, "crop");
});

test("slotIntent treatment rejects values outside the enum", () => {
  assert.throws(() =>
    templateRecipeSchema.parse({
      ...diagonalRecipe(),
      slotIntents: { hero: { treatment: "blurry" } },
    }),
  );
});

test("layout items default to treatment crop and canvas to transparent", () => {
  const item = wallpaperItemSchema.parse({
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
  });
  assert.equal(item.treatment, "crop");
  for (const treatment of ["full", "crop", "cutout"]) {
    assert.equal(
      wallpaperItemSchema.parse({ ...item, treatment }).treatment,
      treatment,
    );
  }
  assert.throws(() => wallpaperItemSchema.parse({ ...item, treatment: "vignette" }));

  // canvas background: omitted → transparent (无纯色底)
  const layout = wallpaperLayoutSchema.parse({
    version: "1.0",
    canvas: {
      width: 1290,
      height: 2795,
      ratio: "9:16",
      usage: "mobile",
    },
    items: [item],
    guidance: {
      intent: "balanced-collage",
      visualFlow: "top-to-bottom",
      transition: { type: "clean-gap", strength: 0.2, feather: 0 },
      boundary: { type: "clean-gap", gap: 24, radius: 0, width: 0 },
      preserveFaces: true,
      preserveNegativeSpace: true,
    },
  });
  assert.equal(layout.canvas.backgroundColor, "transparent");
  // …and legacy layouts that always emit a hex color parse unchanged
  assert.equal(
    wallpaperLayoutSchema.parse({
      ...layout,
      canvas: { ...layout.canvas, backgroundColor: "#4A5D3A" },
    }).canvas.backgroundColor,
    "#4A5D3A",
  );
});

// ---------------------------------------------------------------------------
// diagonal-collage 编译：结构、几何与确定性
// ---------------------------------------------------------------------------

test("compiles 2 heroes at the diagonal ends plus interleaved supports", () => {
  const template = compileDiagonal();

  assert.equal(template.type, "diagonal-collage");
  assertSlotsInsideCanvas(template);

  const heroes = heroesOf(template);
  assert.deepEqual(
    template.slots.map((slot) => slot.id),
    ["hero", "hero-2", "support-1", "support-2", "support-3"],
  );
  assert.equal(heroes.length, 2);

  // axis runs bottom-left → top-right: the first hero hugs the bottom-left
  // corner of the content rect, the second the top-right corner.
  const inset = DEFAULT_TEMPLATE_RECIPES[1].margin; // soft-avoid: plain margin
  const [hero, hero2] = heroes;
  assert.ok(Math.abs(hero.x - inset) < 1e-4);
  assert.ok(Math.abs(hero.y + hero.height - (1 - inset)) < 1e-4);
  assert.ok(Math.abs(hero2.x + hero2.width - (1 - inset)) < 1e-4);
  assert.ok(Math.abs(hero2.y - inset) < 1e-4);
  assert.ok(hero.x + hero.width / 2 < hero2.x + hero2.width / 2);
  assert.ok(hero.y + hero.height / 2 > hero2.y + hero2.height / 2);
});

test("supports alternate z order and consecutive cards overlap", () => {
  const template = compileDiagonal();
  const supports = supportsOf(template);
  assert.equal(supports.length, 3);

  const zIndices = supports.map((slot) => slot.zIndex);
  for (let index = 1; index < zIndices.length; index += 1) {
    assert.notEqual(zIndices[index], zIndices[index - 1]);
  }
  // strict alternation 1, 2, 1, …
  supports.forEach((slot, index) => {
    assert.equal(slot.zIndex, 1 + (index % 2));
  });

  // 交错叠压: each consecutive pair physically overlaps
  for (let index = 1; index < supports.length; index += 1) {
    assert.ok(
      intersectionArea(supports[index - 1], supports[index]) > 0,
      `${supports[index - 1].id} and ${supports[index].id} must overlap`,
    );
  }
});

test("diagonal compilation is deterministic for identical input", () => {
  for (const ratio of [
    PORTRAIT,
    { id: "16:9", width: 1920, height: 1080 },
    { id: "9:19.5", width: 1290, height: 2796 },
  ]) {
    const first = compileDiagonal({ ratio });
    const second = compileDiagonal({ ratio });
    assert.deepEqual(first, second);

    // the branch itself is deterministic independent of the wrapper
    assert.deepEqual(
      planDiagonalCollageSlots({
        recipe: diagonalRecipe(),
        count: 5,
        content: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 },
        width: ratio.width,
        height: ratio.height,
      }),
      planDiagonalCollageSlots({
        recipe: diagonalRecipe(),
        count: 5,
        content: { x: 0.02, y: 0.02, width: 0.96, height: 0.96 },
        width: ratio.width,
        height: ratio.height,
      }),
    );
  }
});

test("diagonal parameters move the geometry deterministically", () => {
  const base = compileDiagonal();
  const heavier = compileDiagonal({
    recipe: { diagonal: { overlap: 0.6 } },
  });
  const mirrored = compileDiagonal({
    recipe: { diagonal: { axis: "tl-br" } },
  });
  const olive = compileDiagonal({
    recipe: { diagonal: { backgroundColor: "#4A5D3A" } },
  });

  // a heavier overlap pulls consecutive supports closer
  const span = (template) => {
    const [a, b] = supportsOf(template);
    return Math.hypot(
      (a.x + a.width / 2 - (b.x + b.width / 2)),
      (a.y + a.height / 2 - (b.y + b.height / 2)),
    );
  };
  assert.ok(span(heavier) < span(base));

  // tl-br mirrors the hero placement across the canvas diagonal
  const [hero, hero2] = heroesOf(mirrored);
  const inset = DEFAULT_TEMPLATE_RECIPES[1].margin;
  assert.ok(Math.abs(hero.y - inset) < 1e-4);
  assert.ok(Math.abs(hero2.y + hero2.height - (1 - inset)) < 1e-4);

  // backgroundColor is a recipe parameter, not a geometry one: identical slots
  assert.deepEqual(olive.slots, base.slots);

  // params validate within bounds and reject outside them
  templateRecipeSchema.parse(
    diagonalRecipe({ diagonal: { heroShare: 0.6, supportShare: 0.1, overlap: 0 } }),
  );
  assert.throws(() =>
    templateRecipeSchema.parse(
      diagonalRecipe({ diagonal: { overlap: 0.75 } }),
    ),
  );
  assert.throws(() =>
    templateRecipeSchema.parse(
      diagonalRecipe({ diagonal: { backgroundColor: "olive" } }),
    ),
  );
  assert.throws(() =>
    templateRecipeSchema.parse(
      diagonalRecipe({ diagonal: { axis: "lr" } }),
    ),
  );
});

test("diagonal recipes without params compile with reference defaults", () => {
  const template = compileDiagonal();
  // defaults: axis bl-tr, heroShare 0.46, supportShare 0.24, overlap 0.3
  const [hero] = heroesOf(template);
  const contentWidth = 1 - DEFAULT_TEMPLATE_RECIPES[1].margin * 2;
  assert.ok(Math.abs(hero.width - 0.46 * contentWidth) < 1e-4);
});

// ---------------------------------------------------------------------------
// 素材不足降级：按序丢弃次图槽，不报错
// ---------------------------------------------------------------------------

test("short asset counts drop trailing support slots in order", () => {
  // recipe asks for 2 heroes + 3 supports; 4 assets keep support-1/-2
  const four = compileDiagonal({ assetCount: 4 });
  assert.deepEqual(
    four.slots.map((slot) => slot.id),
    ["hero", "hero-2", "support-1", "support-2"],
  );
  assert.equal(heroesOf(four).length, 2);
  assertSlotsInsideCanvas(four);

  // 3 assets keep a single support; 2 assets leave the two heroes alone
  const three = compileDiagonal({ assetCount: 3 });
  assert.deepEqual(
    three.slots.map((slot) => slot.id),
    ["hero", "hero-2", "support-1"],
  );
  const two = compileDiagonal({ assetCount: 2 });
  assert.deepEqual(
    two.slots.map((slot) => slot.id),
    ["hero", "hero-2"],
  );

  // the shared two-asset floor still applies
  assert.throws(() => compileDiagonal({ assetCount: 1 }), /at least two assets/);

  // supportCount caps: 5 supports wanted, 6-slot ceiling keeps 4
  const capped = compileDiagonal({
    assetCount: 8,
    recipe: { supportCount: 5 },
  });
  assert.deepEqual(
    capped.slots.map((slot) => slot.id),
    ["hero", "hero-2", "support-1", "support-2", "support-3", "support-4"],
  );
});

test("planning a short diagonal candidate never throws", () => {
  const template = compileDiagonal({ assetCount: 4 });
  const planned = planTemplateCandidate({
    analyses: fiveAnalyses.slice(0, 4),
    canvasSize: { width: PORTRAIT.width, height: PORTRAIT.height },
    ratioId: PORTRAIT.id,
    template,
    templateIndex: 0,
    templateSource: "generated",
    templateRecipe: diagonalRecipe(),
  });
  assert.equal(planned.layout.items.length, 4);
  assert.equal(planned.usedFallback, false);
});

// ---------------------------------------------------------------------------
// treatment / 背景色透传（recipe → 布局）
// ---------------------------------------------------------------------------

test("slot treatments pass through verbatim into layout items", () => {
  const template = compileDiagonal();
  const planned = planTemplateCandidate({
    analyses: fiveAnalyses,
    canvasSize: { width: PORTRAIT.width, height: PORTRAIT.height },
    ratioId: PORTRAIT.id,
    template,
    templateIndex: 0,
    templateSource: "generated",
    templateRecipe: diagonalRecipe({
      slotIntents: {
        hero: { treatment: "cutout" },
        "support-1": { treatment: "full" },
        "support-2": { cropIntent: { focus: "subject" } },
      },
    }),
  });

  const bySlot = new Map(planned.layout.items.map((item) => [item.slotId, item]));
  assert.equal(bySlot.get("hero").treatment, "cutout");
  assert.equal(bySlot.get("hero-2").treatment, "crop"); // no intent → default
  assert.equal(bySlot.get("support-1").treatment, "full");
  assert.equal(bySlot.get("support-2").treatment, "crop"); // intent w/o treatment
  assert.equal(bySlot.get("support-3").treatment, "crop");
});

test("diagonal background color flows to the canvas, absent means transparent", () => {
  const template = compileDiagonal();
  const plan = (recipe) =>
    planTemplateCandidate({
      analyses: fiveAnalyses,
      canvasSize: { width: PORTRAIT.width, height: PORTRAIT.height },
      ratioId: PORTRAIT.id,
      template,
      templateIndex: 0,
      templateSource: "generated",
      templateRecipe: recipe,
    });

  assert.equal(
    plan(diagonalRecipe({ diagonal: { backgroundColor: "#4A5D3A" } })).layout
      .canvas.backgroundColor,
    "#4A5D3A",
  );
  assert.equal(plan(diagonalRecipe()).layout.canvas.backgroundColor, "transparent");
});

test("registered diagonal presets plan with the olive ground and crop default", () => {
  for (const id of ["diagonal_collage_mobile", "diagonal_collage_desktop"]) {
    const preset = getTemplate(id);
    assert.equal(preset.type, "diagonal-collage");
    assert.equal(preset.slots.length, 5);
    assert.equal(heroesOf(preset).length, 2);
    // square corners, no rotation — the reference facts
    preset.slots.forEach((slot) => {
      assert.equal(slot.shape, "rect");
      assert.equal(slot.rotation, 0);
    });

    const planned = planTemplateCandidate({
      analyses: fiveAnalyses,
      canvasSize:
        id === "diagonal_collage_mobile"
          ? { width: 1290, height: 2795 }
          : { width: 1920, height: 1080 },
      ratioId: id === "diagonal_collage_mobile" ? "9:16" : "16:9",
      template: preset,
      templateIndex: 0,
    });
    assert.equal(planned.layout.items.length, 5);
    assert.equal(planned.layout.canvas.backgroundColor, "#4A5D3A");
    planned.layout.items.forEach((item) => {
      assert.equal(item.treatment, "crop");
      assert.equal(item.style.shadow, "none");
    });
  }
});

test("planning is deterministic end-to-end for the same recipe", () => {
  const plan = () =>
    planTemplateCandidate({
      analyses: fiveAnalyses,
      canvasSize: { width: PORTRAIT.width, height: PORTRAIT.height },
      ratioId: PORTRAIT.id,
      template: compileDiagonal(),
      templateIndex: 0,
      templateSource: "generated",
      templateRecipe: diagonalRecipe({
        diagonal: { backgroundColor: "#4A5D3A" },
        slotIntents: { hero: { treatment: "cutout" } },
      }),
    });
  assert.deepEqual(plan(), plan());
});
