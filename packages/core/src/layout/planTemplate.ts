import { colorDistance, hexToHsl } from "../image/colorAnalysis.ts";
import {
  applySafeAreaAvoidance,
  type CompileSafeArea,
} from "./compileTemplateRecipe.ts";
import { wallpaperLayoutSchema } from "./layoutSchema.ts";
import type { CanvasSize } from "../types/canvas.ts";
import type {
  CompositionIntent,
  ImageAssetAnalysis,
  LayoutCandidate,
  TemplateSlot,
  WallpaperItem,
  WallpaperTemplate,
} from "../types/layout.ts";
import type { SafeAreaType, WallpaperRatioId } from "../types/wallpaper.ts";
import type { TemplateRecipe } from "./templateRecipe.ts";
import { createSafeAreas } from "../wallpaper/layoutSafeAreas.ts";

export interface TemplatePlanInput {
  analyses: ImageAssetAnalysis[];
  canvasSize: CanvasSize;
  ratioId: WallpaperRatioId;
  template: WallpaperTemplate;
  templateIndex: number;
  intent?: CompositionIntent;
  templateSource?: "registered" | "generated";
  templateRecipe?: TemplateRecipe;
  /**
   * Optional safe-area rectangles in target pixels — the same caliber the
   * composition brief produces and the recipe compiler consumes. When
   * provided, registered-template slots that intersect an area are
   * translated or shrunk clear of it (experiment finding 4): equal-strip
   * templates inset as one group so the equal rhythm survives, everything
   * else runs the per-slot avoidance the generated path already uses.
   * Absent or empty `safeAreas` plans exactly as before.
   */
  safeAreas?: CompileSafeArea[];
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(Math.max(value, minimum), maximum);
}

function usageForRatio(ratioId: WallpaperRatioId) {
  if (ratioId === "9:16" || ratioId === "9:19.5") {
    return "mobile" as const;
  }
  return ratioId === "21:9" ? ("ultrawide" as const) : ("desktop" as const);
}

export function calculateCoverCrop(
  analysis: ImageAssetAnalysis,
  slotWidth: number,
  slotHeight: number,
) {
  const sourceAspect = analysis.aspectRatio;
  const targetAspect = slotWidth / slotHeight;
  const faceCenter =
    analysis.faces && analysis.faces.length > 0
      ? {
          x:
            analysis.faces.reduce(
              (total, face) => total + face.x + face.width / 2,
              0,
            ) / analysis.faces.length,
          y:
            analysis.faces.reduce(
              (total, face) => total + face.y + face.height / 2,
              0,
            ) / analysis.faces.length,
        }
      : null;
  const subjectCenter = analysis.subjectBox
    ? {
        x: analysis.subjectBox.x + analysis.subjectBox.width / 2,
        y: analysis.subjectBox.y + analysis.subjectBox.height / 2,
      }
    : null;
  const focalPoint =
    faceCenter ??
    subjectCenter ??
    analysis.saliencyCenter ?? { x: 0.5, y: 0.5 };

  if (sourceAspect > targetAspect) {
    const width = targetAspect / sourceAspect;
    return {
      x: clamp(focalPoint.x - width / 2, 0, 1 - width),
      y: 0,
      width,
      height: 1,
      focalPoint,
    };
  }

  const height = sourceAspect / targetAspect;
  const isPortraitInLandscape =
    analysis.orientation === "portrait" && targetAspect > 1;
  const fallbackY = isPortraitInLandscape
    ? (1 - height) * 0.35
    : (1 - height) / 2;
  const y =
    faceCenter || subjectCenter || analysis.saliencyCenter
      ? clamp(focalPoint.y - height / 2, 0, 1 - height)
      : fallbackY;
  return {
    x: 0,
    y,
    width: 1,
    height,
    focalPoint,
  };
}

function createItemStyle(template: WallpaperTemplate, slotIndex: number) {
  if (template.type === "layered-moodboard") {
    return {
      radius: 32,
      shadow: "strong" as const,
      border: { width: 1, color: "rgba(255,255,255,0.74)" },
    };
  }

  if (template.type === "irregular-collage") {
    return {
      radius: 22,
      shadow: "soft" as const,
      border: { width: 1, color: "rgba(255,255,255,0.8)" },
    };
  }

  if (template.id.includes("editorial") || template.type === "portrait-triptych") {
    return {
      radius: 28,
      shadow: "soft" as const,
      border: { width: 1, color: "rgba(255,255,255,0.72)" },
    };
  }

  if (template.id.includes("equal")) {
    return {
      radius: 0,
      shadow: "none" as const,
      border: {
        width: slotIndex === 1 ? 2 : 1,
        color: "rgba(255,255,255,0.78)",
      },
    };
  }

  return { radius: 0, shadow: "none" as const };
}

function boundaryForTemplate(template: WallpaperTemplate) {
  if (template.id.includes("cinematic")) {
    return { type: "edge-to-edge" as const, gap: 0, radius: 0, width: 0 };
  }

  if (template.type === "layered-moodboard") {
    return { type: "overlap" as const, gap: 0, radius: 32, width: 0 };
  }

  if (template.type === "irregular-collage") {
    return { type: "paper-edge" as const, gap: 18, radius: 22, width: 1 };
  }

  if (template.id.includes("editorial") || template.type === "portrait-triptych") {
    return { type: "soft-shadow" as const, gap: 36, radius: 28, width: 1 };
  }

  return { type: "clean-gap" as const, gap: 24, radius: 0, width: 1 };
}

function transitionForTemplate(template: WallpaperTemplate) {
  if (template.id.includes("cinematic")) {
    return { type: "soft-gradient" as const, strength: 0.45, feather: 32 };
  }

  if (template.type === "layered-moodboard") {
    return { type: "overlap-shadow" as const, strength: 0.5, feather: 48 };
  }

  if (template.type === "irregular-collage") {
    return { type: "shared-color-wash" as const, strength: 0.52, feather: 64 };
  }

  return { type: "clean-gap" as const, strength: 0.2, feather: 0 };
}

function intentForTemplate(
  template: WallpaperTemplate,
  intent: CompositionIntent | undefined,
) {
  if (intent) {
    return intent;
  }

  if (template.id.includes("editorial") || template.type === "portrait-triptych") {
    return "hero-with-support" as const;
  }

  if (template.id.includes("cinematic")) {
    return "story-strip" as const;
  }

  return "balanced-collage" as const;
}

function backgroundColorForTemplate(
  template: WallpaperTemplate,
  analyses: ImageAssetAnalysis[],
) {
  if (template.id.includes("cinematic")) {
    return "#10151d";
  }

  if (template.type === "layered-moodboard") {
    return analyses[0]?.averageColor ?? "#20242d";
  }

  return "#f4f3ed";
}

function orientationScore(slot: TemplateSlot, analysis: ImageAssetAnalysis) {
  const slotAspect = slot.width / slot.height;
  const slotOrientation =
    Math.abs(slotAspect - 1) < 0.12
      ? "square"
      : slotAspect > 1
        ? "landscape"
        : "portrait";

  if (analysis.orientation === slotOrientation) {
    return 1;
  }

  if (slot.role === "hero" && analysis.bestUse?.includes("hero")) {
    return 0.75;
  }

  return 0.45;
}

function roleScore(slot: TemplateSlot, analysis: ImageAssetAnalysis) {
  if (slot.role === "hero") {
    return (
      analysis.resolutionScore * 0.7 +
      (analysis.bestUse?.includes("hero") ? 0.3 : 0)
    );
  }

  if (slot.role === "background") {
    return (
      analysis.resolutionScore * 0.5 +
      (analysis.bestUse?.includes("background") ? 0.5 : 0)
    );
  }

  return analysis.resolutionScore * 0.6 + orientationScore(slot, analysis) * 0.4;
}

function selectAssetsForSlots(
  template: WallpaperTemplate,
  analyses: ImageAssetAnalysis[],
) {
  const sortedSlots = [...template.slots].sort(
    (left, right) =>
      right.zIndex - left.zIndex ||
      (right.role === "hero" ? 1 : 0) - (left.role === "hero" ? 1 : 0),
  );
  const assigned = new Map<string, ImageAssetAnalysis>();
  const usedAssetIds = new Set<string>();
  const theme = hexToHsl(
    [...analyses].sort(
      (left, right) => right.resolutionScore - left.resolutionScore,
    )[0].averageColor,
  );

  sortedSlots.forEach((slot) => {
    const candidates = analyses
      .filter((analysis) => !usedAssetIds.has(analysis.assetId))
      .sort((left, right) => {
        const leftScore =
          roleScore(slot, left) * 0.65 +
          (1 - colorDistance(hexToHsl(left.averageColor), theme)) * 0.35;
        const rightScore =
          roleScore(slot, right) * 0.65 +
          (1 - colorDistance(hexToHsl(right.averageColor), theme)) * 0.35;
        return rightScore - leftScore;
      });
    const selected = candidates[0] ?? analyses[assigned.size % analyses.length];
    assigned.set(slot.id, selected);
    usedAssetIds.add(selected.assetId);
  });

  return assigned;
}

function createLayoutItem(
  template: WallpaperTemplate,
  slot: TemplateSlot,
  slotIndex: number,
  analysis: ImageAssetAnalysis,
  canvasSize: CanvasSize,
  templateIndex: number,
): WallpaperItem {
  const width = Math.round(slot.width * canvasSize.width);
  const height = Math.round(slot.height * canvasSize.height);

  return {
    id: `layout_${templateIndex + 1}_${slot.id}`,
    assetId: analysis.assetId,
    slotId: slot.id,
    role: slot.role,
    x: Math.round(slot.x * canvasSize.width),
    y: Math.round(slot.y * canvasSize.height),
    width,
    height,
    rotation: slot.rotation,
    zIndex: slot.zIndex,
    opacity: slot.role === "decorative" ? 0.92 : 1,
    fit: "cover",
    crop: calculateCoverCrop(analysis, width, height),
    mask: {
      type: slot.shape,
      radius:
        slot.shape === "rounded-rect"
          ? Math.round(
              (slot.radius ?? 0) *
                Math.min(canvasSize.width, canvasSize.height),
            )
          : undefined,
      polygon: slot.polygon,
    },
    style: createItemStyle(template, slotIndex),
  };
}

// ---------------------------------------------------------------------------
// Safe-area avoidance for registered templates (experiment finding 4): the
// fixed slot geometry in templates.ts never consulted the brief's safe areas,
// so registered candidates scored 0.0000-0.3098 on safe-area adherence while
// generated candidates in the same scenarios scored 1.0. Areas arrive in
// target pixels and are normalized here — the same caliber the recipe
// compiler's `applySafeAreaAvoidance` consumes (evalScoring's
// `candidateSafeAreaScore` scores that rectangle).
// ---------------------------------------------------------------------------

type NormalizedSafeArea = {
  type: SafeAreaType;
  rect: { x: number; y: number; width: number; height: number };
};

/** Two slots this close in size count as an equal-strip template. */
const STRIP_EQUALITY_TOLERANCE = 0.01;
/** Smallest inner extent the uniform group inset keeps on one axis. */
const MIN_GROUP_INNER_EXTENT = 0.15;
const AVOID_EPS = 1e-9;

function intersectsRect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x + a.width > b.x + AVOID_EPS &&
    b.x + b.width > a.x + AVOID_EPS &&
    a.y + a.height > b.y + AVOID_EPS &&
    b.y + b.height > a.y + AVOID_EPS
  );
}

/**
 * Equal-strip templates (triptych equal/cinematic: every slot shares one
 * size) keep their rhythm by insetting as a group — a per-slot repair would
 * collapse only the slot facing the icon column and break the equal thirds.
 */
function isUniformStripTemplate(template: WallpaperTemplate) {
  if (template.slots.length < 2) {
    return false;
  }
  const [first, ...rest] = template.slots;
  return rest.every(
    (slot) =>
      Math.abs(slot.width - first.width) <= STRIP_EQUALITY_TOLERANCE &&
      Math.abs(slot.height - first.height) <= STRIP_EQUALITY_TOLERANCE,
  );
}

function roundStripRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const round = (value: number) => Number(value.toFixed(5));
  const width = round(Math.min(1, Math.max(0.01, rect.width)));
  const height = round(Math.min(1, Math.max(0.01, rect.height)));
  return {
    x: round(Math.min(Math.max(rect.x, 0), 1 - width)),
    y: round(Math.min(Math.max(rect.y, 0), 1 - height)),
    width,
    height,
  };
}

/** Clamps one axis's insets so the group keeps a usable inner extent. */
function clampAxisInsets(start: number, end: number): [number, number] {
  if (1 - start - end >= MIN_GROUP_INNER_EXTENT || start + end <= 0) {
    return [start, end];
  }
  const scale = (1 - MIN_GROUP_INNER_EXTENT) / (start + end);
  return [start * scale, end * scale];
}

/**
 * Insets the whole slot group clear of edge-band safe areas by remapping the
 * group into the shrunken content rect — an order-preserving affine map, so
 * equal slots stay equal, gaps stay proportional, and no overlap is
 * introduced. Center-block areas (subject-protection) are left to the
 * per-slot fallback in `applyRegisteredSafeAreaAvoidance`.
 */
function insetUniformStrip(
  slots: TemplateSlot[],
  areas: NormalizedSafeArea[],
): TemplateSlot[] {
  const groupLeft = Math.min(...slots.map((slot) => slot.x));
  const groupTop = Math.min(...slots.map((slot) => slot.y));
  const groupRight = Math.max(...slots.map((slot) => slot.x + slot.width));
  const groupBottom = Math.max(...slots.map((slot) => slot.y + slot.height));
  const group = {
    x: groupLeft,
    y: groupTop,
    width: groupRight - groupLeft,
    height: groupBottom - groupTop,
  };

  let insetLeft = 0;
  let insetRight = 0;
  let insetTop = 0;
  let insetBottom = 0;
  let edgeHit = false;
  for (const area of areas) {
    if (!intersectsRect(group, area.rect)) {
      continue;
    }
    if (area.type === "desktop-icons-left") {
      insetLeft = Math.max(insetLeft, area.rect.x + area.rect.width);
      edgeHit = true;
    } else if (area.type === "desktop-icons-right") {
      insetRight = Math.max(insetRight, 1 - area.rect.x);
      edgeHit = true;
    } else if (area.type === "desktop-dock") {
      insetBottom = Math.max(insetBottom, 1 - area.rect.y);
      edgeHit = true;
    } else if (
      area.type === "mobile-clock" ||
      area.type === "mobile-widget-center"
    ) {
      insetTop = Math.max(insetTop, area.rect.y + area.rect.height);
      edgeHit = true;
    }
  }
  if (!edgeHit) {
    return slots;
  }

  [insetLeft, insetRight] = clampAxisInsets(insetLeft, insetRight);
  [insetTop, insetBottom] = clampAxisInsets(insetTop, insetBottom);
  const innerWidth = 1 - insetLeft - insetRight;
  const innerHeight = 1 - insetTop - insetBottom;

  return slots.map((slot) => ({
    ...slot,
    ...roundStripRect({
      x: insetLeft + slot.x * innerWidth,
      y: insetTop + slot.y * innerHeight,
      width: slot.width * innerWidth,
      height: slot.height * innerHeight,
    }),
  }));
}

/**
 * Adjusts a registered template's fixed slots against pixel safe areas.
 * Equal-strip templates inset as a group first; anything still intersecting
 * after that (or non-strip templates, layered families, center blocks) runs
 * the recipe compiler's per-slot avoidance, with the full canvas as the
 * content rect.
 */
function applyRegisteredSafeAreaAvoidance(
  template: WallpaperTemplate,
  safeAreas: CompileSafeArea[],
  width: number,
  height: number,
): TemplateSlot[] {
  if (safeAreas.length === 0 || width <= 0 || height <= 0) {
    return template.slots;
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
    return template.slots;
  }

  const adjusted = isUniformStripTemplate(template)
    ? insetUniformStrip(template.slots, areas)
    : template.slots;
  const stillIntersects = adjusted.some((slot) =>
    areas.some((area) =>
      intersectsRect(
        { x: slot.x, y: slot.y, width: slot.width, height: slot.height },
        area.rect,
      ),
    ),
  );
  if (!stillIntersects) {
    return adjusted;
  }

  return applySafeAreaAvoidance(
    adjusted,
    { x: 0, y: 0, width: 1, height: 1 },
    safeAreas,
    width,
    height,
    template.type === "layered-moodboard",
  );
}

export function planTemplateCandidate({
  analyses,
  canvasSize,
  ratioId,
  template,
  templateIndex,
  intent,
  templateSource,
  templateRecipe,
  safeAreas,
}: TemplatePlanInput): LayoutCandidate {
  // Slot geometry avoidance (finding 4) happens on a shallow copy: the
  // registry's templates are shared module state and must stay untouched.
  const planningTemplate = {
    ...template,
    slots: applyRegisteredSafeAreaAvoidance(
      template,
      safeAreas ?? [],
      canvasSize.width,
      canvasSize.height,
    ),
  };
  const assetsBySlot = selectAssetsForSlots(planningTemplate, analyses);
  const items = planningTemplate.slots.map((slot, slotIndex) => {
    const analysis = assetsBySlot.get(slot.id);
    if (!analysis) {
      throw new Error(`Missing analysis for template slot: ${slot.id}`);
    }
    return createLayoutItem(
      template,
      slot,
      slotIndex,
      analysis,
      canvasSize,
      templateIndex,
    );
  });
  const focalAssetId =
    items.find((item) => item.role === "hero")?.assetId ?? items[0]?.assetId;
  const harmonyScore = clamp(
    items.reduce((total, item) => {
      const analysis = analyses.find((candidate) => candidate.assetId === item.assetId);
      return total + (analysis?.resolutionScore ?? 0.5);
    }, 0) / Math.max(items.length, 1),
  );
  const usage = usageForRatio(ratioId);
  const layout = wallpaperLayoutSchema.parse({
    version: "1.0",
    canvas: {
      width: canvasSize.width,
      height: canvasSize.height,
      ratio: ratioId,
      usage,
      backgroundColor: backgroundColorForTemplate(template, analyses),
    },
    template: {
      id: template.id,
      type: template.type,
      ...(templateSource ? { source: templateSource } : {}),
      ...(templateRecipe ? { recipe: templateRecipe } : {}),
    },
    items,
    safeAreas: createSafeAreas(ratioId, canvasSize.width, canvasSize.height),
    guidance: {
      intent: intentForTemplate(template, intent),
      focalAssetId,
      visualFlow: usage === "mobile" ? "top-to-bottom" : "left-to-right",
      transition: transitionForTemplate(template),
      boundary: boundaryForTemplate(template),
      preserveFaces: true,
      preserveNegativeSpace: template.type !== "irregular-collage",
    },
    notes: [
      `${template.name} matched ${items.length} template slots to the highest scoring analyzed assets.`,
    ],
  });

  return {
    id: `candidate_${template.id}`,
    label: template.name,
    reason: `${template.name} uses ${template.type} slots to turn analyzed image traits into editable Layout JSON.`,
    harmonyScore,
    usedFallback: new Set(items.map((item) => item.assetId)).size < items.length,
    layout,
  };
}

export function generateTemplateCandidates(
  analyses: ImageAssetAnalysis[],
  canvasSize: CanvasSize,
  ratioId: WallpaperRatioId,
  templates: WallpaperTemplate[],
  intent?: CompositionIntent,
) {
  return templates.map((template, templateIndex) =>
    planTemplateCandidate({
      analyses,
      canvasSize,
      ratioId,
      template,
      templateIndex,
      intent,
    }),
  );
}
