import { templateRecipeSchema } from "../layout/templateRecipe.ts";

import type { TemplateRecipe } from "../layout/templateRecipe.ts";

function includesAny(input: string, terms: string[]) {
  return terms.some((term) => input.includes(term));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function refineTemplateRecipe(
  current: TemplateRecipe,
  instruction: string,
  assetCount: number,
) {
  const normalized = instruction.trim().toLocaleLowerCase();
  const next: TemplateRecipe = {
    ...current,
    supportCount: clamp(assetCount - 1, 1, 5),
  };

  if (
    includesAny(normalized, [
      "more whitespace",
      "more space",
      "留白",
      "更松",
      "呼吸感",
    ])
  ) {
    next.margin = clamp(next.margin + 0.018, 0, 0.12);
    next.gap = clamp(next.gap + 0.008, 0, 0.06);
  }
  if (
    includesAny(normalized, [
      "compact",
      "tighter",
      "紧凑",
      "更密",
      "少一点留白",
    ])
  ) {
    next.margin = clamp(next.margin - 0.012, 0, 0.12);
    next.gap = clamp(next.gap - 0.006, 0, 0.06);
  }
  if (
    includesAny(normalized, [
      "larger",
      "bigger",
      "more prominent",
      "更大",
      "突出主图",
    ])
  ) {
    next.heroShare = clamp(next.heroShare + 0.08, 0.32, 0.76);
  }
  if (
    includesAny(normalized, [
      "smaller",
      "less prominent",
      "小一点",
      "弱化主图",
    ])
  ) {
    next.heroShare = clamp(next.heroShare - 0.08, 0.32, 0.76);
  }
  if (
    includesAny(normalized, [
      "ordered",
      "aligned",
      "neater",
      "整齐",
      "规整",
      "对齐",
    ])
  ) {
    next.family = "hero-grid";
    next.rhythm = "ordered";
    next.boundary = "clean-gap";
  }
  if (
    includesAny(normalized, [
      "dynamic",
      "layered",
      "depth",
      "动态",
      "层次",
      "错落",
    ])
  ) {
    next.family = "layered-collage";
    next.rhythm = "layered";
    next.boundary = "overlap";
  }
  if (includesAny(normalized, ["left", "左边", "左侧"])) {
    next.heroPosition = "left";
  }
  if (includesAny(normalized, ["right", "右边", "右侧"])) {
    next.heroPosition = "right";
  }
  if (includesAny(normalized, ["top", "上方", "顶部"])) {
    next.heroPosition = "top";
  }
  if (includesAny(normalized, ["center", "中央", "居中"])) {
    next.heroPosition = "center";
  }

  return templateRecipeSchema.parse(next);
}
