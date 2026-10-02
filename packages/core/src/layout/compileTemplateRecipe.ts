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
import type { SafeAreaType } from "../types/wallpaper.ts";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FocalPoint = { x: number; y: number };

type CoverCrop = Rect & { focalPoint: FocalPoint };

/**
 * A safe-area rectangle supplied to the compiler in target pixels — the same
 * unit and caliber as layout `safeAreas` (what evalScoring's
 * `candidateSafeAreaScore` measures item overlap against). The compiler
 * normalizes by `width` / `height` before applying avoidance.
 */
export interface CompileSafeArea {
  type: SafeAreaType;
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  /**
   * Optional safe-area rectangles in target pixels. When provided, slots
   * that intersect an area are translated or shrunk to clear it:
   *
   * - side columns (desktop-icons-left/right) shrink the facing edge;
   * - desktop-dock caps the slot-height upper bound at the dock's top;
   * - horizontal bands (mobile-clock, mobile-widget-center,
   *   subject-protection) translate the hero below the band bottom and
   *   pull support tops below it;
   * - adjusted slots stay inside the content rect and gap-style slots
   *   stay mutually non-overlapping.
   *
   * Absent or empty `safeAreas` compiles exactly as before.
   */
  safeAreas?: CompileSafeArea[];
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

  if (portrait || position === "top" || position === "bottom") {
    const heroHeight = content.height * recipe.heroShare;
    const heroAtBottom = position === "bottom";
    hero = heroAtBottom
      ? {
          x: content.x,
          y: content.y + content.height - heroHeight,
          width: content.width,
          height: heroHeight,
        }
      : {
          x: content.x,
          y: content.y,
          width: content.width,
          height: heroHeight,
        };
    supportRect = heroAtBottom
      ? {
          x: content.x,
          y: content.y,
          width: content.width,
          height: content.height - heroHeight - gap,
        }
      : {
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
  // An explicit edge anchor (left/right/top/bottom) pins the hero to that
  // edge with the supports stacked on the opposite side — the hero-grid
  // geometry. center (and the legacy background default) keeps the
  // centered mosaic structure below, unchanged.
  if (
    recipe.heroPosition === "left" ||
    recipe.heroPosition === "right" ||
    recipe.heroPosition === "top" ||
    recipe.heroPosition === "bottom"
  ) {
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
  // Slot IDs stay contiguous across the hero position: the planner prompt
  // contract is "hero, support-1 onward", so the strip layout must not skip a
  // support number where the hero sits (a 3-slot strip compiles to
  // support-1, hero, support-2 — never support-3, which no model assigns).
  return rects.map((rect, index) =>
    slot(
      index === heroIndex
        ? "hero"
        : `support-${index < heroIndex ? index + 1 : index}`,
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

// ---------------------------------------------------------------------------
// Safe-area avoidance (experiment findings 3/4): slot rectangles that cross a
// reserved safe area are translated or shrunk clear of it. Areas arrive in
// target pixels and are normalized against the compile width/height — the
// same rectangle caliber `evalScoring.candidateSafeAreaScore` scores against.
// ---------------------------------------------------------------------------

const AVOID_EPS = 1e-9;
/** Smallest slot extent (normalized) the avoidance keeps when shrinking. */
const MIN_AVOIDED_SLOT_EXTENT = 0.03;
/** Separation kept between slots re-packed by overlap resolution. */
const OVERLAP_SEPARATION = 0.008;

type NormalizedSafeArea = { type: SafeAreaType; rect: Rect };

function intersectsRect(a: Rect, b: Rect): boolean {
  return (
    a.x + a.width > b.x + AVOID_EPS &&
    b.x + b.width > a.x + AVOID_EPS &&
    a.y + a.height > b.y + AVOID_EPS &&
    b.y + b.height > a.y + AVOID_EPS
  );
}

function clampIntoContent(rect: Rect, content: Rect): Rect {
  const width = Math.min(Math.max(rect.width, 0.01), content.width);
  const height = Math.min(Math.max(rect.height, 0.01), content.height);
  return {
    x: clamp(rect.x, content.x, content.x + content.width - width),
    y: clamp(rect.y, content.y, content.y + content.height - height),
    width,
    height,
  };
}

function sameRect(a: Rect, b: Rect): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

function overlapsAnyRect(rect: Rect, others: Rect[]): boolean {
  return others.some((other) => intersectsRect(rect, other));
}

/** Hero places first (it anchors the composition), supports follow in slot
 * order, the layered background goes last. */
function placementRank(slot: TemplateSlot): number {
  if (slot.role === "hero") {
    return 0;
  }
  return slot.role === "background" ? 2 : 1;
}

/** Icon columns: shrink the facing edge out of the column; translate when the
 * remaining width would be too narrow. */
function avoidSideColumn(
  rect: Rect,
  area: Rect,
  content: Rect,
  side: "left" | "right",
): Rect {
  if (side === "left") {
    const areaRight = area.x + area.width;
    if (rect.x + rect.width - areaRight >= MIN_AVOIDED_SLOT_EXTENT) {
      return clampIntoContent(
        { ...rect, x: areaRight, width: rect.x + rect.width - areaRight },
        content,
      );
    }
    return clampIntoContent({ ...rect, x: areaRight }, content);
  }
  const areaLeft = area.x;
  if (areaLeft - rect.x >= MIN_AVOIDED_SLOT_EXTENT) {
    return clampIntoContent({ ...rect, width: areaLeft - rect.x }, content);
  }
  return clampIntoContent({ ...rect, x: areaLeft - rect.width }, content);
}

/** Dock strip: cap the slot's height upper bound at the dock's top edge. */
function avoidDockStrip(rect: Rect, area: Rect, content: Rect): Rect {
  const dockTop = area.y;
  if (rect.y < dockTop - MIN_AVOIDED_SLOT_EXTENT) {
    return clampIntoContent({ ...rect, height: dockTop - rect.y }, content);
  }
  // The slot starts inside the dock strip: keep its bottom at the dock top.
  const height = Math.min(rect.height, dockTop - content.y);
  return clampIntoContent({ ...rect, y: dockTop - height, height }, content);
}

/** Horizontal bands (clock / widget / subject-protection): the hero (and the
 * layered background) translate fully below the band bottom edge; supports
 * pull their top edge below the band, keeping the bottom edge. Every step is
 * bounded by `obstacles` (already-placed rects plus the original lanes of
 * slots not repaired yet), and when the space below the band cannot host the
 * slot, it falls back to the space above the band — clearing a band never
 * trades the safe-area hit for a slot overlap. */
function avoidBlockBand(
  rect: Rect,
  area: Rect,
  content: Rect,
  heroic: boolean,
  obstacles: Rect[],
): Rect {
  const bandBottom = area.y + area.height;
  const contentBottom = content.y + content.height;
  let roomBottom = contentBottom;
  for (const obstacle of obstacles) {
    if (
      obstacle.y - OVERLAP_SEPARATION < roomBottom &&
      obstacle.y >= bandBottom - AVOID_EPS &&
      obstacle.x + obstacle.width > rect.x + AVOID_EPS &&
      rect.x + rect.width > obstacle.x + AVOID_EPS
    ) {
      roomBottom = obstacle.y - OVERLAP_SEPARATION;
    }
  }
  if (heroic) {
    if (bandBottom + rect.height <= roomBottom + AVOID_EPS) {
      return clampIntoContent({ ...rect, y: bandBottom }, content);
    }
    if (roomBottom - bandBottom >= MIN_AVOIDED_SLOT_EXTENT) {
      return clampIntoContent(
        { ...rect, y: bandBottom, height: roomBottom - bandBottom },
        content,
      );
    }
    return fitAboveBand(rect, area, content, obstacles) ?? rect;
  }
  // Supports: pull the top edge below the band, keeping the bottom edge,
  // but never past a slot occupying the space under the band.
  const cappedHeight = rect.y + rect.height - bandBottom;
  if (cappedHeight >= MIN_AVOIDED_SLOT_EXTENT) {
    const height = Math.min(cappedHeight, roomBottom - bandBottom);
    if (height >= MIN_AVOIDED_SLOT_EXTENT) {
      return clampIntoContent({ ...rect, y: bandBottom, height }, content);
    }
  }
  const translated = { ...rect, y: bandBottom };
  if (
    bandBottom + rect.height <= roomBottom + AVOID_EPS &&
    !overlapsAnyRect(translated, obstacles)
  ) {
    return clampIntoContent(translated, content);
  }
  if (roomBottom - bandBottom >= MIN_AVOIDED_SLOT_EXTENT) {
    return clampIntoContent(
      { ...rect, y: bandBottom, height: roomBottom - bandBottom },
      content,
    );
  }
  return fitAboveBand(rect, area, content, obstacles) ?? rect;
}

/** Last-resort placement for band avoidance: fit the slot into the space
 * between the content top and the band's top edge, if that space is tall
 * enough and free of other slots. */
function fitAboveBand(
  rect: Rect,
  area: Rect,
  content: Rect,
  obstacles: Rect[],
): Rect | null {
  const height = Math.min(
    rect.height,
    area.y - OVERLAP_SEPARATION - content.y,
  );
  if (height < MIN_AVOIDED_SLOT_EXTENT) {
    return null;
  }
  const candidate = {
    ...rect,
    y: area.y - OVERLAP_SEPARATION - height,
    height,
  };
  if (overlapsAnyRect(candidate, obstacles)) {
    return null;
  }
  return clampIntoContent(candidate, content);
}

function avoidAllAreas(
  rect: Rect,
  role: TemplateSlot["role"],
  content: Rect,
  areas: NormalizedSafeArea[],
  obstacles: Rect[],
): Rect {
  const heroic = role === "hero" || role === "background";
  // Side columns first (horizontal repair), then the dock cap, then block
  // bands ordered by ascending bottom edge so the deepest band's pull wins.
  const ordered = [
    ...areas.filter(
      (area) =>
        area.type === "desktop-icons-left" || area.type === "desktop-icons-right",
    ),
    ...areas.filter((area) => area.type === "desktop-dock"),
    ...areas
      .filter(
        (area) =>
          area.type !== "desktop-icons-left" &&
          area.type !== "desktop-icons-right" &&
          area.type !== "desktop-dock",
      )
      .sort(
        (left, right) =>
          left.rect.y +
          left.rect.height -
          (right.rect.y + right.rect.height),
      ),
  ];

  let current = { ...rect };
  for (let round = 0; round <= ordered.length; round += 1) {
    let changed = false;
    for (const area of ordered) {
      if (!intersectsRect(current, area.rect)) {
        continue;
      }
      let next: Rect;
      if (area.type === "desktop-icons-left") {
        next = avoidSideColumn(current, area.rect, content, "left");
      } else if (area.type === "desktop-icons-right") {
        next = avoidSideColumn(current, area.rect, content, "right");
      } else if (area.type === "desktop-dock") {
        next = avoidDockStrip(current, area.rect, content);
      } else {
        next = avoidBlockBand(current, area.rect, content, heroic, obstacles);
      }
      if (!sameRect(next, current)) {
        current = next;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return current;
}

/** Moves `rect` out of `obstacle`, preferring below, then above, then
 * shrinking into whichever side still has room inside the content rect. */
function pushAwayFrom(rect: Rect, obstacle: Rect, content: Rect): Rect {
  const below = obstacle.y + obstacle.height + OVERLAP_SEPARATION;
  const contentBottom = content.y + content.height;
  if (below + rect.height <= contentBottom + AVOID_EPS) {
    return clampIntoContent({ ...rect, y: below }, content);
  }
  const above = obstacle.y - OVERLAP_SEPARATION - rect.height;
  if (above >= content.y - AVOID_EPS) {
    return clampIntoContent({ ...rect, y: above }, content);
  }
  const belowHeight = contentBottom - below;
  if (belowHeight >= MIN_AVOIDED_SLOT_EXTENT) {
    return clampIntoContent({ ...rect, y: below, height: belowHeight }, content);
  }
  const aboveHeight = obstacle.y - OVERLAP_SEPARATION - content.y;
  if (aboveHeight >= MIN_AVOIDED_SLOT_EXTENT) {
    return clampIntoContent(
      { ...rect, y: content.y, height: aboveHeight },
      content,
    );
  }
  return rect;
}

/**
 * Resolves overlaps that the avoidance *introduced*. Pairs that already
 * overlapped before adjustment keep overlapping (layered-collage semantics);
 * callers skip this entirely for the layered family, whose overlap is the
 * design.
 */
function resolveIntroducedOverlaps(
  slots: TemplateSlot[],
  previous: Rect[],
  adjusted: Rect[],
  content: Rect,
): Rect[] {
  const result = adjusted.map((rect) => ({ ...rect }));
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index].role === "background") {
      continue;
    }
    for (let guard = 0; guard < slots.length; guard += 1) {
      let moved = false;
      for (let other = 0; other < index; other += 1) {
        if (slots[other].role === "background") {
          continue;
        }
        if (!intersectsRect(result[index], result[other])) {
          continue;
        }
        if (intersectsRect(previous[index], previous[other])) {
          continue;
        }
        result[index] = pushAwayFrom(result[index], result[other], content);
        moved = true;
      }
      if (!moved) {
        break;
      }
    }
  }
  return result;
}

/**
 * Applies safe-area avoidance to compiled slots. Slots are repaired in
 * placement order — hero first, then supports, background last — and each
 * repair sees the already-placed slots as obstacles, so clearing a band never
 * trades a safe-area hit for a slot overlap. Layered-collage keeps its
 * deliberate hero/support/background overlaps (only safe-area intersections
 * are repaired); gap-style families additionally re-separate slots whose
 * overlap the repair still introduced.
 */
export function applySafeAreaAvoidance(
  slots: TemplateSlot[],
  content: Rect,
  safeAreas: CompileSafeArea[],
  width: number,
  height: number,
  layered: boolean,
): TemplateSlot[] {
  if (safeAreas.length === 0 || width <= 0 || height <= 0) {
    return slots;
  }
  const areas: NormalizedSafeArea[] = safeAreas
    .filter((area) => area.width > 0 && area.height > 0)
    .map((area) => ({
      type: area.type,
      rect: {
        x: area.x / width,
        y: area.y / height,
        width: area.width / width,
        height: area.height / height,
      },
    }));
  if (areas.length === 0) {
    return slots;
  }

  const previous = slots.map((slot) => ({
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
  }));
  const placementOrder = slots
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) => {
      const rankDelta = placementRank(left.slot) - placementRank(right.slot);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      // Supports place bottom-up: lower rows anchor first, so rows pushed
      // below a band shrink against them instead of shoving them around.
      return previous[right.index].y - previous[left.index].y;
    });
  const adjusted: Rect[] = new Array(slots.length);
  const placed: Rect[] = [];
  for (const { slot, index } of placementOrder) {
    // The layered family overlaps by design, and the background sits behind
    // everything: neither dodges other slots, only the safe areas. Gap-style
    // slots dodge the already-placed (adjusted) rects plus the original
    // lanes of slots not placed yet — a band translate must not land on a
    // support that has not been repaired itself.
    const obstacles =
      layered || slot.role === "background"
        ? []
        : [
            ...placed,
            ...placementOrder
              .slice(placed.length)
              .filter(
                (pending) =>
                  pending.index !== index &&
                  pending.slot.role !== "background",
              )
              .map((pending) => previous[pending.index]),
          ];
    adjusted[index] = avoidAllAreas(
      previous[index],
      slot.role,
      content,
      areas,
      obstacles,
    );
    placed.push(adjusted[index]);
  }
  const resolved = layered
    ? adjusted
    : resolveIntroducedOverlaps(slots, previous, adjusted, content);

  return slots.map((current, index) => ({
    ...current,
    ...roundBox(resolved[index]),
  }));
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
  if (input.safeAreas && input.safeAreas.length > 0) {
    slots = applySafeAreaAvoidance(
      slots,
      content,
      input.safeAreas,
      input.width,
      input.height,
      recipe.family === "layered-collage",
    );
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
