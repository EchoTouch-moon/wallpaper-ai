import { wallpaperTemplateSchema } from "./layoutSchema.ts";
import { templateRecipeSchema } from "./templateRecipe.ts";

import type { TemplateRecipe } from "./templateRecipe.ts";
import type {
  TemplateSlot,
  TemplateType,
  WallpaperTemplate,
} from "../types/layout.ts";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface CompileTemplateRecipeInput {
  recipe: TemplateRecipe;
  ratioId: string;
  width: number;
  height: number;
  assetCount: number;
}

function round(value: number) {
  return Number(value.toFixed(5));
}

function slot(
  id: string,
  rect: Rect,
  role: TemplateSlot["role"],
  index: number,
  recipe: TemplateRecipe,
): TemplateSlot {
  const dynamicRotation =
    recipe.profile === "dynamic" && role !== "background"
      ? index % 2 === 0
        ? -1.4
        : 1.4
      : 0;
  return {
    id,
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
    rotation: dynamicRotation,
    zIndex: role === "background" ? 0 : role === "hero" ? 3 : index + 1,
    role,
    shape: recipe.cornerRadius > 0 ? "rounded-rect" : "rect",
    radius: recipe.cornerRadius > 0 ? recipe.cornerRadius : undefined,
  };
}

function insetRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(0.01, rect.width - amount * 2),
    height: Math.max(0.01, rect.height - amount * 2),
  };
}

function splitGrid(
  rect: Rect,
  count: number,
  gap: number,
  preferredColumns?: number,
) {
  if (count <= 0) {
    return [];
  }
  const columns = Math.max(
    1,
    Math.min(count, preferredColumns ?? Math.ceil(Math.sqrt(count))),
  );
  const rows = Math.ceil(count / columns);
  const cellWidth = (rect.width - gap * (columns - 1)) / columns;
  const cellHeight = (rect.height - gap * (rows - 1)) / rows;

  return Array.from({ length: count }, (_, index): Rect => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const remaining = count - row * columns;
    const rowColumns = Math.min(columns, remaining);
    const rowWidth = rowColumns * cellWidth + (rowColumns - 1) * gap;
    const rowOffset = (rect.width - rowWidth) / 2;
    return {
      x: rect.x + rowOffset + column * (cellWidth + gap),
      y: rect.y + row * (cellHeight + gap),
      width: cellWidth,
      height: cellHeight,
    };
  });
}

function heroGridSlots(
  content: Rect,
  count: number,
  recipe: TemplateRecipe,
  portrait: boolean,
) {
  const supportCount = count - 1;
  const gap = recipe.gap;
  const position =
    recipe.heroPosition === "center" ||
    recipe.heroPosition === "background"
      ? portrait
        ? "top"
        : "left"
      : recipe.heroPosition;
  let hero: Rect;
  let supportRect: Rect;

  if (portrait || position === "top") {
    const heroHeight = content.height * recipe.heroShare;
    hero = {
      x: content.x,
      y: content.y,
      width: content.width,
      height: heroHeight,
    };
    supportRect = {
      x: content.x,
      y: content.y + heroHeight + gap,
      width: content.width,
      height: content.height - heroHeight - gap,
    };
  } else {
    const heroWidth = content.width * recipe.heroShare;
    const heroOnRight = position === "right";
    hero = {
      x: heroOnRight
        ? content.x + content.width - heroWidth
        : content.x,
      y: content.y,
      width: heroWidth,
      height: content.height,
    };
    supportRect = {
      x: heroOnRight ? content.x : content.x + heroWidth + gap,
      y: content.y,
      width: content.width - heroWidth - gap,
      height: content.height,
    };
  }

  return [
    slot("hero", hero, "hero", 0, recipe),
    ...splitGrid(
      supportRect,
      supportCount,
      gap,
      portrait ? Math.min(2, supportCount) : supportCount > 2 ? 2 : 1,
    ).map((rect, index) =>
      slot(`support-${index + 1}`, rect, "support", index + 1, recipe),
    ),
  ];
}

function balancedMosaicSlots(
  content: Rect,
  count: number,
  recipe: TemplateRecipe,
  portrait: boolean,
) {
  if (count === 2) {
    return heroGridSlots(content, count, recipe, portrait);
  }
  const gap = recipe.gap;
  const heroShare = Math.min(0.58, Math.max(0.42, recipe.heroShare));
  const hero = portrait
    ? {
        x: content.x,
        y: content.y + content.height * (1 - heroShare) * 0.5,
        width: content.width,
        height: content.height * heroShare,
      }
    : {
        x: content.x + content.width * (1 - heroShare) * 0.5,
        y: content.y,
        width: content.width * heroShare,
        height: content.height,
      };
  const beforeRect = portrait
    ? {
        x: content.x,
        y: content.y,
        width: content.width,
        height: hero.y - content.y - gap,
      }
    : {
        x: content.x,
        y: content.y,
        width: hero.x - content.x - gap,
        height: content.height,
      };
  const afterRect = portrait
    ? {
        x: content.x,
        y: hero.y + hero.height + gap,
        width: content.width,
        height:
          content.y + content.height - (hero.y + hero.height + gap),
      }
    : {
        x: hero.x + hero.width + gap,
        y: content.y,
        width:
          content.x + content.width - (hero.x + hero.width + gap),
        height: content.height,
      };
  const beforeCount = Math.floor((count - 1) / 2);
  const afterCount = count - 1 - beforeCount;

  return [
    slot("hero", hero, "hero", 0, recipe),
    ...splitGrid(beforeRect, beforeCount, gap, portrait ? beforeCount : 1).map(
      (rect, index) =>
        slot(`support-${index + 1}`, rect, "support", index + 1, recipe),
    ),
    ...splitGrid(afterRect, afterCount, gap, portrait ? afterCount : 1).map(
      (rect, index) =>
        slot(
          `support-${beforeCount + index + 1}`,
          rect,
          "support",
          beforeCount + index + 1,
          recipe,
        ),
    ),
  ];
}

function stripSlots(
  content: Rect,
  count: number,
  recipe: TemplateRecipe,
  portrait: boolean,
) {
  const rects = splitGrid(
    content,
    count,
    recipe.gap,
    portrait ? 1 : count,
  );
  const heroIndex = Math.floor(count / 2);
  return rects.map((rect, index) =>
    slot(
      index === heroIndex ? "hero" : `support-${index + 1}`,
      rect,
      index === heroIndex ? "hero" : "support",
      index,
      recipe,
    ),
  );
}

function layeredSlots(
  content: Rect,
  count: number,
  recipe: TemplateRecipe,
  portrait: boolean,
) {
  const slots: TemplateSlot[] = [
    slot("background", content, "background", 0, recipe),
  ];
  if (count === 1) {
    return slots;
  }
  const heroWidth = portrait ? content.width * 0.84 : content.width * 0.62;
  const heroHeight = portrait ? content.height * 0.5 : content.height * 0.76;
  const hero = {
    x: content.x + (content.width - heroWidth) * 0.32,
    y: content.y + (content.height - heroHeight) * 0.28,
    width: heroWidth,
    height: heroHeight,
  };
  slots.push(slot("hero", hero, "hero", 1, recipe));
  const remaining = count - 2;
  if (remaining <= 0) {
    return slots;
  }
  const cardWidth = portrait ? content.width * 0.46 : content.width * 0.3;
  const cardHeight = portrait ? content.height * 0.18 : content.height * 0.3;
  for (let index = 0; index < remaining; index += 1) {
    const progress = remaining === 1 ? 0.5 : index / (remaining - 1);
    const x = portrait
      ? content.x +
        (index % 2 === 0 ? 0.04 : content.width - cardWidth - 0.04)
      : content.x + content.width - cardWidth - 0.03;
    const y = portrait
      ? content.y + content.height * (0.58 + progress * 0.18)
      : content.y + content.height * (0.08 + progress * 0.56);
    slots.push(
      slot(
        `support-${index + 1}`,
        insetRect({ x, y, width: cardWidth, height: cardHeight }, 0),
        "support",
        index + 2,
        recipe,
      ),
    );
  }
  return slots;
}

function typeForRecipe(recipe: TemplateRecipe): TemplateType {
  switch (recipe.family) {
    case "hero-grid":
      return "hero-grid";
    case "balanced-mosaic":
      return "balanced-mosaic";
    case "stacked-story":
      return "stacked-story";
    case "layered-collage":
      return "layered-moodboard";
    case "triptych":
      return "triptych";
  }
}

export function compileTemplateRecipe(
  input: CompileTemplateRecipeInput,
): WallpaperTemplate {
  const recipe = templateRecipeSchema.parse(input.recipe);
  if (!Number.isInteger(input.assetCount) || input.assetCount < 2) {
    throw new Error("Template recipes require at least two assets");
  }
  const count = Math.min(input.assetCount, recipe.supportCount + 1, 6);
  const portrait = input.height > input.width;
  const content = insetRect(
    { x: 0, y: 0, width: 1, height: 1 },
    recipe.margin + (recipe.safeAreaPolicy === "avoid" ? 0.005 : 0),
  );
  let slots: TemplateSlot[];

  switch (recipe.family) {
    case "hero-grid":
      slots = heroGridSlots(content, count, recipe, portrait);
      break;
    case "balanced-mosaic":
      slots = balancedMosaicSlots(content, count, recipe, portrait);
      break;
    case "triptych":
    case "stacked-story":
      slots = stripSlots(content, count, recipe, portrait);
      break;
    case "layered-collage":
      slots = layeredSlots(content, count, recipe, portrait);
      break;
  }

  return wallpaperTemplateSchema.parse({
    id: `generated_${recipe.profile}_${recipe.family}_${input.ratioId.replace(/[^a-z0-9]+/gi, "_")}_${count}`,
    name: `${recipe.profile[0].toUpperCase()}${recipe.profile.slice(1)} ${recipe.family.replaceAll("-", " ")}`,
    type: typeForRecipe(recipe),
    supportedRatios: [input.ratioId],
    minImages: count,
    maxImages: count,
    slots,
  });
}
