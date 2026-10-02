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
import type {
  CropFocus,
  CropZoom,
  TemplateRecipe,
} from "./templateRecipe.ts";
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

// ---------------------------------------------------------------------------
// Retention-aware crop targets (contour-aware cropping). A cover-crop window
// keeps its aspect-driven size and slides along its single free axis (the
// other axis always spans the full [0, 1]); the helpers below only decide
// WHERE it slides. Target priority:
//
//   1. faces present           → window must fully contain the padded face
//                                union; when it cannot fit, maximize the
//                                area-weighted covered face length
//   2. valid subjectPolygon    → maximize window ∩ polygon area
//   3. occupancy grid only     → maximize retained occupied cells
//   4. neither signal          → the original focal clamp, bit-for-bit
//
// `focus: "contour"` skips level 1 (the recipe explicitly asked for the
// contour); `focus: "faces"` is the default data-driven behavior. Every
// solver below is closed-form over a finite, deterministic candidate set —
// no image processing, no iteration-to-threshold, bounded work (≤ 48²
// polygon steps, ≤ 12² face steps, ≤ gridSize candidates with prefix-free
// counting).
// ---------------------------------------------------------------------------

/**
 * Local copy of compileTemplateRecipe's CROP_ZOOM_FACTORS: importing it back
 * would create a module cycle (compileTemplateRecipe imports this file). The
 * values are protocol constants — keep the two tables in sync.
 */
const COVER_CROP_ZOOM_FACTORS = {
  tight: 0.8,
  standard: 1,
  loose: 1.2,
} as const;

/** Padding added around the face-box union before fitting the window. */
const FACE_UNION_PADDING_RATIO = 0.1;

/** Numeric tolerances for deterministic score/tie comparisons. */
const CROP_FLOAT_EPS = 1e-12;
const CROP_SCORE_EPS = 1e-12;

export interface CoverCropOptions {
  /**
   * Semantic crop focus from a recipe slotIntent. Only the analysis-driven
   * targets ("faces", "contour") change geometry here — every other focus
   * value is resolved downstream by `applyCropIntent`, exactly as before.
   */
  focus?: CropFocus;
  /** Zoom tier; consumed here only alongside a "faces"/"contour" focus. */
  zoom?: CropZoom;
}

type ContourPoint = { x: number; y: number };

interface SlideRequest {
  /** The free axis the cover-crop window slides along. */
  axis: "x" | "y";
  /** Window extent along the sliding axis. */
  windowLength: number;
  /**
   * The legacy clamp result, returned verbatim when no contour/face signal
   * applies (the bit-for-bit fallback guard).
   */
  fallbackOffset: number;
  /** Tie-break anchor: the offset the legacy focal clamp would prefer. */
  preferredOffset: number;
}

/**
 * Deterministically picks the best offset from a candidate set: highest
 * score wins; exact-score ties go to the offset closest to the legacy
 * preferred offset; remaining ties to the smaller offset (candidates are
 * iterated in ascending order).
 */
function pickBestOffset(
  candidates: number[],
  scoreOffset: (offset: number) => number,
  preferredOffset: number,
): number {
  let bestOffset = candidates[0];
  let bestScore = -Infinity;
  let bestTie = Infinity;
  for (const offset of candidates) {
    const score = scoreOffset(offset);
    if (score > bestScore + CROP_SCORE_EPS) {
      bestOffset = offset;
      bestScore = score;
      bestTie = Math.abs(offset - preferredOffset);
      continue;
    }
    if (Math.abs(score - bestScore) <= CROP_SCORE_EPS) {
      const tie = Math.abs(offset - preferredOffset);
      if (tie < bestTie - CROP_FLOAT_EPS) {
        bestOffset = offset;
        bestTie = tie;
      }
    }
  }
  return bestOffset;
}

function sortedUniqueCandidates(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function decodeSubjectPolygon(
  polygon: Array<ContourPoint> | undefined,
): ContourPoint[] | null {
  if (!polygon || polygon.length < 3) {
    return null;
  }
  return polygon.map((point) => ({
    x: clamp(point.x),
    y: clamp(point.y),
  }));
}

function decodeOccupancyGrid(
  contour: ImageAssetAnalysis["subjectContour"],
): { cells: string; size: number } | null {
  if (!contour || typeof contour.grid !== "string") {
    return null;
  }
  const size = contour.gridSize;
  if (
    !Number.isInteger(size) ||
    size < 16 ||
    size > 64 ||
    contour.grid.length !== size * size ||
    !/^[01]+$/.test(contour.grid)
  ) {
    return null;
  }
  return { cells: contour.grid, size };
}

/**
 * Level 1 — hard face-union constraint. The padded union (10% of the union
 * span on each side) must fit inside the window; when it does not, the
 * piecewise-linear area-weighted coverage is maximized exactly by evaluating
 * its breakpoints (window edges aligned with face-interval edges).
 */
function faceUnionSlideOffset(
  faces: NonNullable<ImageAssetAnalysis["faces"]>,
  request: SlideRequest,
): number {
  const length = request.windowLength;
  const maxOffset = 1 - length;
  const intervals = faces.map((face) => {
    const start = request.axis === "x" ? face.x : face.y;
    const extent = request.axis === "x" ? face.width : face.height;
    return {
      start,
      end: start + extent,
      weight: face.width * face.height,
    };
  });

  const unionStart = Math.min(...intervals.map((interval) => interval.start));
  const unionEnd = Math.max(...intervals.map((interval) => interval.end));
  const padding = (unionEnd - unionStart) * FACE_UNION_PADDING_RATIO;
  const targetStart = unionStart - padding;
  const targetEnd = unionEnd + padding;

  // Hard constraint feasible: window covers [targetStart, targetEnd], placed
  // as centrally as the legal slide domain allows.
  const fitLow = Math.max(0, targetEnd - length);
  const fitHigh = Math.min(maxOffset, targetStart);
  if (fitLow <= fitHigh + CROP_FLOAT_EPS) {
    const ideal = clamp((targetStart + targetEnd) / 2 - length / 2, 0, maxOffset);
    return clamp(ideal, fitLow, fitHigh);
  }

  // Does not fit: maximize Σ(faceArea × covered length). The objective is
  // piecewise linear in the offset, so its optimum sits at a breakpoint —
  // a window edge flush with a face-interval edge (or the domain bounds).
  const candidates = sortedUniqueCandidates([
    0,
    maxOffset,
    ...intervals.flatMap((interval) => [
      clamp(interval.start, 0, maxOffset),
      clamp(interval.end - length, 0, maxOffset),
    ]),
  ]);
  return pickBestOffset(
    candidates,
    (offset) =>
      intervals.reduce(
        (total, interval) =>
          total +
          interval.weight *
            Math.max(
              0,
              Math.min(interval.end, offset + length) -
                Math.max(interval.start, offset),
            ),
        0,
      ),
    request.preferredOffset,
  );
}

/** Shoelace area of a simple polygon (absolute value). */
function polygonArea(points: ContourPoint[]): number {
  let doubledArea = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(doubledArea) / 2;
}

/**
 * Sutherland–Hodgman clip of the polygon against one half-plane (the
 * deterministic rectangle-clip building block). `inside` tests a point,
 * `crossing` interpolates the polygon edge × clip-boundary intersection.
 */
function clipHalfPlane(
  points: ContourPoint[],
  inside: (point: ContourPoint) => boolean,
  crossing: (from: ContourPoint, to: ContourPoint) => ContourPoint,
): ContourPoint[] {
  const output: ContourPoint[] = [];
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const currentInside = inside(current);
    const nextInside = inside(next);
    if (currentInside) {
      output.push(current);
    }
    if (currentInside !== nextInside) {
      output.push(crossing(current, next));
    }
  }
  return output;
}

/**
 * Level 2 — maximize the window ∩ polygon area. The intersection area is
 * piecewise linear in the slide offset (Sutherland–Hodgman keeps every
 * vertex a linear function of it), so its optimum sits where a window edge
 * sweeps a polygon vertex — a finite, exhaustive candidate set.
 */
function polygonOverlapSlideOffset(
  polygon: ContourPoint[],
  request: SlideRequest,
): number {
  const length = request.windowLength;
  const maxOffset = 1 - length;
  const axis = request.axis;
  const coordinate = (point: ContourPoint) => point[axis];

  // The window covers the full [0, 1] along the other axis, so only the two
  // half-planes along the sliding axis clip.
  const intersectionArea = (offset: number) => {
    let clipped = polygon;
    clipped = clipHalfPlane(
      clipped,
      (point) => coordinate(point) >= offset,
      (from, to) => {
        const t = (offset - coordinate(from)) / (coordinate(to) - coordinate(from));
        return {
          x: from.x + t * (to.x - from.x),
          y: from.y + t * (to.y - from.y),
        };
      },
    );
    if (clipped.length < 3) {
      return 0;
    }
    clipped = clipHalfPlane(
      clipped,
      (point) => coordinate(point) <= offset + length,
      (from, to) => {
        const t =
          (offset + length - coordinate(from)) /
          (coordinate(to) - coordinate(from));
        return {
          x: from.x + t * (to.x - from.x),
          y: from.y + t * (to.y - from.y),
        };
      },
    );
    return clipped.length < 3 ? 0 : polygonArea(clipped);
  };

  const candidates = sortedUniqueCandidates([
    0,
    maxOffset,
    ...polygon.flatMap((point) => [
      clamp(coordinate(point), 0, maxOffset),
      clamp(coordinate(point) - length, 0, maxOffset),
    ]),
  ]);
  return pickBestOffset(
    candidates,
    intersectionArea,
    request.preferredOffset,
  );
}

/**
 * Level 3 — maximize retained occupied grid cells. Along the sliding axis
 * the retention is a step function whose plateaus break exactly where a
 * window edge aligns with an occupied-cell center, so evaluating those
 * alignments (plus the domain bounds) is exact. Row-major grid: cell
 * (row, column) has its center at ((column + 0.5) / size, (row + 0.5) / size).
 */
function gridRetentionSlideOffset(
  grid: { cells: string; size: number },
  request: SlideRequest,
): number {
  const length = request.windowLength;
  const maxOffset = 1 - length;
  const centers: number[] = [];
  for (let index = 0; index < grid.cells.length; index++) {
    if (grid.cells[index] !== "1") {
      continue;
    }
    const row = Math.floor(index / grid.size);
    const column = index % grid.size;
    centers.push(((request.axis === "x" ? column : row) + 0.5) / grid.size);
  }
  if (centers.length === 0) {
    return request.fallbackOffset;
  }
  centers.sort((left, right) => left - right);

  const candidates = sortedUniqueCandidates([
    0,
    maxOffset,
    ...centers.flatMap((center) => [
      clamp(center, 0, maxOffset),
      clamp(center - length, 0, maxOffset),
    ]),
  ]);
  return pickBestOffset(
    candidates,
    (offset) => {
      let retained = 0;
      for (const center of centers) {
        if (
          center >= offset - CROP_FLOAT_EPS &&
          center <= offset + length + CROP_FLOAT_EPS
        ) {
          retained++;
        }
      }
      return retained;
    },
    request.preferredOffset,
  );
}

/**
 * Applies the retention-aware target priority for one slide axis. Returns
 * the legacy fallback offset untouched whenever the analysis carries no
 * face/contour signal (the baseline-identity guard).
 */
function resolveSlideOffset(
  analysis: ImageAssetAnalysis,
  options: CoverCropOptions,
  request: SlideRequest,
): number {
  const faces = analysis.faces ?? [];
  const polygon = decodeSubjectPolygon(analysis.subjectContour?.subjectPolygon);
  const grid = decodeOccupancyGrid(analysis.subjectContour);

  // focus "contour" explicitly demotes faces; every other focus (including
  // the default and "faces") keeps faces as the top-priority target.
  if (options.focus !== "contour" && faces.length > 0) {
    return faceUnionSlideOffset(faces, request);
  }
  if (polygon) {
    return polygonOverlapSlideOffset(polygon, request);
  }
  if (grid) {
    return gridRetentionSlideOffset(grid, request);
  }
  return request.fallbackOffset;
}

export function calculateCoverCrop(
  analysis: ImageAssetAnalysis,
  slotWidth: number,
  slotHeight: number,
  options: CoverCropOptions = {},
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

  // Zoom is consumed here only for the analysis-driven targets — every other
  // focus keeps the legacy split where applyCropIntent applies the zoom.
  const zoomFactor =
    (options.focus === "faces" || options.focus === "contour") && options.zoom
      ? COVER_CROP_ZOOM_FACTORS[options.zoom]
      : 1;

  if (sourceAspect > targetAspect) {
    const width = Math.min(1, (targetAspect / sourceAspect) * zoomFactor);
    const fallbackX = clamp(focalPoint.x - width / 2, 0, 1 - width);
    return {
      x: resolveSlideOffset(analysis, options, {
        axis: "x",
        windowLength: width,
        fallbackOffset: fallbackX,
        preferredOffset: fallbackX,
      }),
      y: 0,
      width,
      height: 1,
      focalPoint,
    };
  }

  const height = Math.min(1, (sourceAspect / targetAspect) * zoomFactor);
  const isPortraitInLandscape =
    analysis.orientation === "portrait" && targetAspect > 1;
  const fallbackY = isPortraitInLandscape
    ? (1 - height) * 0.35
    : (1 - height) / 2;
  const clampedY = clamp(focalPoint.y - height / 2, 0, 1 - height);
  const y = resolveSlideOffset(analysis, options, {
    axis: "y",
    windowLength: height,
    fallbackOffset:
      faceCenter || subjectCenter || analysis.saliencyCenter
        ? clampedY
        : fallbackY,
    preferredOffset: clampedY,
  });
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
