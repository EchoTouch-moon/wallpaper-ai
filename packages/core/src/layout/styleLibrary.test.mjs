import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStyleAnchor,
  getStyle,
  listStyles,
  styleAnchorSchema,
  summarizeRecipeSlots,
} from "./styleLibrary.ts";
import { templateRecipeSchema } from "./templateRecipe.ts";

// Verbatim "what the protocol cannot express" styleNotes from the P1 run
// (temp/style-reverse-run-data.json seeds[].styleNotes). The library must
// keep them byte-identical — they are the honest record of the decorative
// layer the recipe alone will not reproduce.
const RUN_DATA_STYLE_NOTES = {
  "xhs-diagonal":
    "The layout features a strong diagonal axis from bottom-left to top-right with significant overlapping elements. It includes decorative text banners (标题, 装饰文字), ornamental shapes (装饰), and circular accent stickers (点缀) that are not captured by the standard slot system. The background has a solid olive-green tone, and the composition uses a mix of rectangular and non-rectangular decorative overlays with varying opacities and soft edges.",
  "canva-portrait-scrapbook":
    "The recipe captures the layered, scrapbook-style composition with a central hero image and two polaroid-style support photos, but cannot express the specific decorative text overlays (e.g., 'Only for you', Chinese typography, dates), the handwritten script background texture, the botanical line art illustrations, or the precise white border/polaroid frame styling and slight rotation angles of the support images.",
  "canva-browser-window":
    "The layout mimics a digital desktop or social media interface with UI chrome (browser bars, window controls, close buttons) framing the images as 'windows'. It features heavy typographic overlays in mixed Chinese/English script, decorative starburst and sparkle graphics, soft gradient backgrounds, and drop shadows that give a floating card effect. The aesthetic is bright, airy, and journal-like with pastel blue tones.",
  "canva-kraft-polaroid":
    "The layout features a textured kraft paper background with torn edges and handwritten script overlays. Photos are styled as Polaroid prints with thick white borders, slight rotations, and realistic drop shadows. Decorative elements include a binder clip on the hero image, washi tape strips, paper stickers (butterfly, ginkgo leaf, flower, camera), and text banners ('SUNDAY', 'THIS WEEK') in mixed fonts. Handwritten dates and Chinese captions are placed at the bottom of specific frames.",
  "canva-polka-dot-plog":
    "The layout is heavily decorated with a scrapbook aesthetic, featuring a polka-dot background pattern, lace doily borders, decorative tape (washi), paper bows, star-shaped frames, and handwritten text banners in both Chinese and English. The central visual element is a metallic lunchbox/tin container that acts as a physical frame for two of the support images, while other photos are overlaid with whimsical stickers like teddy bears and headphones.",
};

test("lists the five P1 seeds with unique ids and the xhs diagonal collage included", () => {
  const styles = listStyles();
  assert.equal(styles.length, 5);
  assert.equal(new Set(styles.map((style) => style.id)).size, 5);

  // The P1 acceptance style is mandatory (plan/style-reverse-p1.md §3/§4).
  const xhs = getStyle("xhs-diagonal");
  assert.ok(xhs);
  assert.equal(xhs.recipe.family, "diagonal-collage");
  assert.deepEqual(xhs.recipe.diagonal, {
    backgroundColor: "#5C6B4A",
    axis: "bl-tr",
    heroShare: 0.45,
    supportShare: 0.25,
    overlap: 0.35,
  });
  assert.equal(xhs.recipe.supportCount, 4);
  assert.equal(xhs.recipe.profile, "dynamic");
  assert.equal(xhs.recipe.boundary, "overlap");

  // The other four P1 seeds ship as library entries with their run families.
  const expectedFamilies = {
    "canva-portrait-scrapbook": "layered-collage",
    "canva-browser-window": "hero-grid",
    "canva-kraft-polaroid": "hero-grid",
    "canva-polka-dot-plog": "layered-collage",
  };
  for (const [id, family] of Object.entries(expectedFamilies)) {
    const style = getStyle(id);
    assert.ok(style, `style ${id} must exist`);
    assert.equal(style.recipe.family, family);
  }
});

test("every entry carries complete metadata and a protocol-canonical recipe", () => {
  for (const style of listStyles()) {
    assert.ok(style.id.length >= 3);
    assert.ok(style.name.length >= 3);
    assert.ok(style.sourceRef.startsWith("temp/style-reverse-run-data.json#"));
    assert.ok(style.tags.length > 0);
    assert.ok(style.tags.every((tag) => tag.length > 0));

    // Write-side guarantee: library data parses through the recipe protocol
    // unchanged (no defaults silently injected, no drift).
    assert.deepEqual(
      templateRecipeSchema.parse(style.recipe),
      style.recipe,
      `recipe of ${style.id} must already be protocol-canonical`,
    );

    // styleNotes keeps the protocol-gap text verbatim from the run data.
    assert.equal(style.styleNotes, RUN_DATA_STYLE_NOTES[style.id]);
  }
});

test("getStyle resolves known ids and returns undefined for unknown ones", () => {
  assert.equal(getStyle("xhs-diagonal")?.id, "xhs-diagonal");
  assert.equal(getStyle("no-such-style"), undefined);
  assert.equal(getStyle(""), undefined);
});

test("the library is read-only code-state data", () => {
  assert.throws(() => {
    listStyles()[0].name = "mutated";
  }, TypeError);
  assert.throws(() => {
    listStyles().push(listStyles()[0]);
  }, TypeError);
  // The failed mutations left the library intact.
  assert.equal(listStyles().length, 5);
  assert.equal(getStyle("xhs-diagonal").name, "XHS Diagonal Collage");
});

test("buildStyleAnchor distills a style into the anchor contract", () => {
  const anchor = buildStyleAnchor(getStyle("xhs-diagonal"));

  assert.equal(anchor.styleId, "xhs-diagonal");
  assert.equal(anchor.family, "diagonal-collage");
  assert.equal(anchor.styleNotes, RUN_DATA_STYLE_NOTES["xhs-diagonal"]);
  // Slot summary names the diagonal slot structure and its parameters.
  assert.match(anchor.slotSummary, /dynamic diagonal-collage/);
  assert.match(anchor.slotSummary, /slots hero, hero-2, support-1, support-2, support-3, support-4/);
  assert.match(anchor.slotSummary, /diagonal axis bl-tr/);
  assert.match(anchor.slotSummary, /overlap 0\.35/);
  assert.match(anchor.slotSummary, /bg #5C6B4A/);

  // The anchor round-trips through its schema.
  assert.deepEqual(styleAnchorSchema.parse(anchor), anchor);
});

test("summarizeRecipeSlots mirrors each family's compiler slot naming", () => {
  // layered-collage starts with a background slot.
  const layered = summarizeRecipeSlots(getStyle("canva-polka-dot-plog").recipe);
  assert.match(layered, /slots background, hero, support-1, support-2, support-3, support-4/);
  assert.match(layered, /boundary overlap/);
  assert.match(layered, /layering strong/);

  // hero-grid: one hero plus supports, layering mentioned when present.
  const heroGrid = summarizeRecipeSlots(getStyle("canva-kraft-polaroid").recipe);
  assert.match(heroGrid, /slots hero, support-1, support-2, support-3, support-4/);
  assert.match(heroGrid, /rhythm ordered/);
  assert.match(heroGrid, /hero center share 0\.38/);

  // No diagonal params on non-diagonal families.
  assert.equal(heroGrid.includes("diagonal axis"), false);

  // slotIntents keys travel with the summary.
  assert.match(heroGrid, /slotIntents hero, support-1, support-2, support-3, support-4/);
});
