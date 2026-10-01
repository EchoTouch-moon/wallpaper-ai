import { wallpaperTemplateSchema } from "./layoutSchema.ts";
import { calculateCoverCrop } from "./planTemplate.ts";
import { templateRecipeSchema } from "./templateRecipe.ts";

import type {
  CropFocus,
  CropIntent,
  TemplateRecipe,
  VisualWeight,
} from "./templateRecipe.ts";
import type {
  ImageAssetAnalysis,
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

type FocalPoint = { x: number; y: number };

type CoverCrop = Rect & { focalPoint: FocalPoint };

export interface CompileTemplateRecipeInput {
  recipe: TemplateRecipe;
  ratioId: string;
  width: number;
  height: number;
  assetCount: number;
  /**
   * Optional asset analyses. Crop-intent focus semantics ("subject" /
   * "saliency") read subjectBox / saliencyCenter from the analysis of the
   * asset bound to the slot, so they resolve only when analyses are
   * provided together with `slotAssignments`.
   */
  assets?: ImageAssetAnalysis[];
  /**
   * Optional slotId → assetId binding used to resolve per-slot crop
   * intents. Absent (or unmatched slots) leave the slot without a
   * compiled crop, preserving the downstream cover-crop default.
   */
  slotAssignments?: Record<string, string>;
}

/**
 * Semantic → geometric mapping tables (multimodal planning protocol v2 §2.2).
 * The model emits only these enum/point semantics; every number below lives
 * in the deterministic compiler.
 */
export const CROP_ZOOM_FACTORS = {
  tight: 0.8,
  standard: 1,
  loose: 1.2,
} as const;

export const VISUAL_WEIGHT_SLOT_SCALE = {
  dominant: 1.08,
  balanced: 1,
  subtle: 0.92,
} as const;

/**
 * Overlap offset for the dynamic layered-collage family, in normalized
 * canvas units along the support→hero axis. Negative values pull support
 * cards toward the hero (stronger overlap); positive values push them away.
 */
export const LAYERING_OVERLAP_OFFSET = {
  none: 0.06,
  slight: 0,
  strong: -0.06,
} as const;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function boxCenter(box: Rect): FocalPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Resolves a semantic crop focus against the bound asset's analysis:
 * "subject" prefers the detected subject box, "saliency" prefers the
 * saliency center, "center" is the geometric center, and a custom
 * normalized point is used directly (clamped defensively into [0, 1]).
 * Each analysis-driven mode falls back to the other signal, then to the
 * image center, when the analysis lacks the preferred signal.
 */
export function resolveCropFocus(
  focus: CropFocus,
  analysis: ImageAssetAnalysis,
): FocalPoint {
  if (focus === "center") {
    return { x: 0.5, y: 0.5 };
  }
  if (typeof focus === "object") {
    return { x: clamp(focus.x, 0, 1), y: clamp(focus.y, 0, 1) };
  }
  if (focus === "subject") {
    if (analysis.subjectBox) {
      return boxCenter(analysis.subjectBox);
    }
    if (analysis.saliencyCenter) {
      return { ...analysis.saliencyCenter };
    }
    return { x: 0.5, y: 0.5 };
  }
  if (analysis.saliencyCenter) {
    return { ...analysis.saliencyCenter };
  }
  if (analysis.subjectBox) {
    return boxCenter(analysis.subjectBox);
  }
  return { x: 0.5, y: 0.5 };
}

/**
 * Maps a slot-level cropIntent onto crop geometry, starting from the base
 * cover crop for the slot's aspect ratio:
 *
 * - focus  → the crop box is re-centered on the resolved focal point;
 * - zoom   → the box is scaled by the tier factor (tight 0.8 / standard
 *   1.0 / loose 1.2) around the focal point;
 * - both axes are clamped back into the legal unit domain (0 ≤ x,
 *   x + width ≤ 1), so edge-focused or loosened crops stay valid.
 *
 * Returns null when the intent is semantically inert (no focus and a
 * standard-or-absent zoom), leaving the base cover crop untouched.
 */
export function applyCropIntent(
  coverCrop: CoverCrop,
  cropIntent: CropIntent,
  analysis: ImageAssetAnalysis,
): CoverCrop | null {
  const focus = cropIntent.focus;
  if (
    focus === undefined &&
    (cropIntent.zoom === undefined || cropIntent.zoom === "standard")
  ) {
    return null;
  }

  const focalPoint =
    focus !== undefined
      ? resolveCropFocus(focus, analysis)
      : { ...coverCrop.focalPoint };
  const factor = cropIntent.zoom
    ? CROP_ZOOM_FACTORS[cropIntent.zoom]
    : 1;
  const width = Math.min(1, coverCrop.width * factor);
  const height = Math.min(1, coverCrop.height * factor);

  return {
    x: clamp(focalPoint.x - width / 2, 0, 1 - width),
    y: clamp(focalPoint.y - height / 2, 0, 1 - height),
    width,
    height,
    focalPoint,
  };
}

/**
 * Maps a slot-level visualWeight onto a slot scale tier: the rect scales
 * around its center (dominant +8%, balanced unchanged, subtle −8%), then
 * is clamped back inside the normalized canvas so the grown slot stays in
 * the legal domain.
 */
export function applyVisualWeight(rect: Rect, weight: VisualWeight): Rect {
  const factor = VISUAL_WEIGHT_SLOT_SCALE[weight];
  if (factor === 1) {
    return rect;
  }
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const width = Math.min(1, rect.width * factor);
  const height = Math.min(1, rect.height * factor);
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
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
  // Recipe-level layering is consumed only by the dynamic recipe family
  // (the layered-collage overlap structure): negative offsets pull the
  // support cards toward the hero for stronger overlap, positive offsets
  // separate them. Profiles other than dynamic ignore the knob.
  const layeringOffset =
    recipe.profile === "dynamic" && recipe.layering
      ? LAYERING_OVERLAP_OFFSET[recipe.layering]
      : 0;
  const cardWidth = portrait ? content.width * 0.46 : content.width * 0.3;
  const cardHeight = portrait ? content.height * 0.18 : content.height * 0.3;
  for (let index = 0; index < remaining; index += 1) {
    const progress = remaining === 1 ? 0.5 : index / (remaining - 1);
    const rawX = portrait
      ? content.x +
        (index % 2 === 0 ? 0.04 : content.width - cardWidth - 0.04)
      : content.x + content.width - cardWidth - 0.03;
    const rawY = portrait
      ? content.y + content.height * (0.58 + progress * 0.18)
      : content.y + content.height * (0.08 + progress * 0.56);
    const x = clamp(
      portrait ? rawX : rawX + layeringOffset,
      content.x,
      content.x + content.width - cardWidth,
    );
    const y = clamp(
      portrait ? rawY + layeringOffset : rawY,
      content.y,
      content.y + content.height - cardHeight,
    );
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

/**
 * Rounds a normalized box to the compiler's 5-decimal grid, re-clamping
 * positions after rounding so `x + width ≤ 1` stays exactly true for the
 * schema's boundary refinement.
 */
function roundBox(rect: Rect): Rect {
  const width = round(Math.min(1, Math.max(0.01, rect.width)));
  const height = round(Math.min(1, Math.max(0.01, rect.height)));
  return {
    x: round(clamp(rect.x, 0, 1 - width)),
    y: round(clamp(rect.y, 0, 1 - height)),
    width,
    height,
  };
}

/**
 * Applies per-slot semantic intents (visualWeight scale tier, cropIntent
 * focus/zoom) onto the compiled slots. Requires `assets` + `slotAssignments`
 * to resolve crop intents against the bound asset's analysis; scale tiers
 * are pure slot geometry and always applicable. Slots without an intent —
 * and intents naming slots the recipe does not produce — pass through
 * untouched.
 */
function applySlotIntents(
  slots: TemplateSlot[],
  recipe: TemplateRecipe,
  input: CompileTemplateRecipeInput,
): TemplateSlot[] {
  const intents = recipe.slotIntents;
  if (!intents) {
    return slots;
  }
  const assetById = new Map(
    (input.assets ?? []).map((analysis) => [analysis.assetId, analysis]),
  );

  return slots.map((current): TemplateSlot => {
    const intent = intents[current.id];
    if (!intent) {
      return current;
    }

    let next = current;
    if (intent.visualWeight && intent.visualWeight !== "balanced") {
      const scaled = applyVisualWeight(
        {
          x: current.x,
          y: current.y,
          width: current.width,
          height: current.height,
        },
        intent.visualWeight,
      );
      next = {
        ...next,
        ...roundBox(scaled),
      };
    }

    if (intent.cropIntent) {
      const assignedAssetId = input.slotAssignments?.[current.id];
      const analysis = assignedAssetId
        ? assetById.get(assignedAssetId)
        : undefined;
      if (analysis) {
        const coverCrop = calculateCoverCrop(
          analysis,
          next.width * input.width,
          next.height * input.height,
        );
        const cropped = applyCropIntent(
          coverCrop,
          intent.cropIntent,
          analysis,
        );
        if (cropped) {
          next = {
            ...next,
            crop: {
              ...roundBox(cropped),
              focalPoint: {
                x: round(clamp(cropped.focalPoint.x, 0, 1)),
                y: round(clamp(cropped.focalPoint.y, 0, 1)),
              },
            },
          };
        }
      }
    }

    return next;
  });
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

  slots = applySlotIntents(slots, recipe, input);

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
