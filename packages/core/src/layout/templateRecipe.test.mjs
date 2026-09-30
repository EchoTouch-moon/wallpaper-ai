import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TEMPLATE_RECIPES,
  compileTemplateRecipe,
  templateRecipeSchema,
} from "./index.ts";

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
