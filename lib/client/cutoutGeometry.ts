import type {
  ImageAssetAnalysis,
  WallpaperItem,
  WallpaperLayout,
} from "@wallpaper/core/types";

/**
 * Client-side cutout geometry (treatment = "cutout" / "full").
 *
 * Protocol semantics (layoutSchema.ts / templateRecipe.ts):
 * - "full"   = contain: the whole (cropped) image is fitted into the slot,
 *   aspect preserved, never cropped further.
 * - "crop"   = cover: the compiler's cover crop fills the slot.
 * - "cutout" = contain + polygon clip: the subject polygon from the asset
 *   analysis (`subjectContour.subjectPolygon`, normalized vertices) is
 *   contain-fitted into the slot so the subject stays fully visible, and the
 *   polygon clips away everything else.
 *
 * Everything here is pure coordinate math shared by the Fabric editor canvas
 * and the browser export (Path2D) so both render the same placement.
 */

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelSize {
  width: number;
  height: number;
}

export const FULL_CROP: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };

/** Uniform scale that fits content inside the container without cropping. */
export function containScale(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
): number {
  if (containerWidth <= 0 || containerHeight <= 0) {
    return 0;
  }
  if (contentWidth <= 0 || contentHeight <= 0) {
    return 0;
  }
  return Math.min(
    containerWidth / contentWidth,
    containerHeight / contentHeight,
  );
}

/** Validated subject polygon (normalized) from an asset analysis, or null. */
export function subjectPolygonOf(
  analysis: ImageAssetAnalysis | null | undefined,
): NormalizedPoint[] | null {
  const polygon = analysis?.subjectContour?.subjectPolygon;
  if (!polygon || polygon.length < 3) {
    return null;
  }
  const cleaned: NormalizedPoint[] = [];
  for (const point of polygon) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    ) {
      continue;
    }
    cleaned.push({ x: point.x, y: point.y });
  }
  return cleaned.length >= 3 ? cleaned : null;
}

/** Axis-aligned bounding box of a normalized polygon, or null when empty. */
export function polygonBBox(
  points: readonly NormalizedPoint[],
): NormalizedRect | null {
  if (points.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

interface ClipEdge {
  inside(point: NormalizedPoint): boolean;
  intersect(
    start: NormalizedPoint,
    end: NormalizedPoint,
  ): NormalizedPoint;
}

function rectEdges(rect: NormalizedRect): ClipEdge[] {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return [
    {
      inside: (point) => point.x >= rect.x,
      intersect: (start, end) => {
        const t = (rect.x - start.x) / (end.x - start.x);
        return { x: rect.x, y: lerp(start.y, end.y, t) };
      },
    },
    {
      inside: (point) => point.x <= right,
      intersect: (start, end) => {
        const t = (right - start.x) / (end.x - start.x);
        return { x: right, y: lerp(start.y, end.y, t) };
      },
    },
    {
      inside: (point) => point.y >= rect.y,
      intersect: (start, end) => {
        const t = (rect.y - start.y) / (end.y - start.y);
        return { x: lerp(start.x, end.x, t), y: rect.y };
      },
    },
    {
      inside: (point) => point.y <= bottom,
      intersect: (start, end) => {
        const t = (bottom - start.y) / (end.y - start.y);
        return { x: lerp(start.x, end.x, t), y: bottom };
      },
    },
  ];
}

/**
 * Sutherland–Hodgman clip of a polygon against an axis-aligned normalized
 * rect. A polygon fully outside the rect degrades to fewer than 3 points.
 */
export function clipPolygonToRect(
  points: readonly NormalizedPoint[],
  rect: NormalizedRect,
): NormalizedPoint[] {
  let output: NormalizedPoint[] = [...points];
  for (const edge of rectEdges(rect)) {
    if (output.length === 0) {
      break;
    }
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index];
      const previous = input[(index + input.length - 1) % input.length];
      const currentInside = edge.inside(current);
      const previousInside = edge.inside(previous);
      if (currentInside) {
        if (!previousInside) {
          output.push(edge.intersect(previous, current));
        }
        output.push(current);
      } else if (previousInside) {
        output.push(edge.intersect(previous, current));
      }
    }
  }
  return output;
}

export interface SlotPlacementInput {
  /** Destination slot rect in canvas pixels. */
  slot: PixelRect;
  /** Natural (orientation-corrected) source image size in pixels. */
  imageSize: PixelSize;
  /** Normalized crop box applied to the source; defaults to the full image. */
  crop?: NormalizedRect;
  /**
   * Normalized subject polygon. When present the polygon (clipped to the
   * crop box) is the contain-fit content; otherwise the crop frame itself
   * is contained ("full" semantics).
   */
  polygon?: NormalizedPoint[] | null;
}

export interface SlotPlacement {
  /** Uniform canvas-pixels-per-source-pixel scale of the contain fit. */
  scale: number;
  /** Canvas rect covered by the full source image at `scale`. */
  imageRect: PixelRect;
  /** Canvas rect of the contain-fitted content (polygon bbox or crop frame). */
  subjectRect: PixelRect;
  /**
   * Canvas position for a FabricImage whose width/height equal the crop
   * frame and whose originX/originY are "center" — its center point.
   */
  frameCenter: NormalizedPoint;
  /** Mapped polygon in canvas pixels, when a polygon was supplied. */
  polygonPoints: NormalizedPoint[] | null;
  /**
   * Polygon in the Fabric object's local space (origin at the object
   * center, before scaleX/scaleY) for use as a non-absolute clipPath.
   */
  clipPolygon: NormalizedPoint[] | null;
}

/** The normalized rect that contain-fits into the slot for this input. */
function contentBoxOf(input: SlotPlacementInput): NormalizedRect | null {
  const crop = input.crop ?? FULL_CROP;
  if (!input.polygon) {
    return crop.width > 0 && crop.height > 0 ? crop : null;
  }
  const clipped = clipPolygonToRect(input.polygon, crop);
  if (clipped.length < 3) {
    return null;
  }
  return polygonBBox(clipped);
}

/**
 * Contain placement of a slot's content (subject polygon or crop frame)
 * into the slot rect, plus every coordinate space the two renderers need:
 * canvas pixels for the 2D-export draw, and the Fabric-local clip polygon.
 * Returns null when there is nothing drawable (degenerate content).
 */
export function computeSlotPlacement(
  input: SlotPlacementInput,
): SlotPlacement | null {
  const contentBox = contentBoxOf(input);
  if (
    !contentBox ||
    input.imageSize.width <= 0 ||
    input.imageSize.height <= 0
  ) {
    return null;
  }

  const { slot, imageSize } = input;
  const scale = containScale(
    slot.width,
    slot.height,
    contentBox.width * imageSize.width,
    contentBox.height * imageSize.height,
  );
  if (scale <= 0) {
    return null;
  }

  // Source point p (px) maps to canvas p * scale + offset, with the offset
  // chosen so the content box center lands on the slot center.
  const contentCenterX = (contentBox.x + contentBox.width / 2) * imageSize.width;
  const contentCenterY = (contentBox.y + contentBox.height / 2) * imageSize.height;
  const offsetX = slot.x + slot.width / 2 - contentCenterX * scale;
  const offsetY = slot.y + slot.height / 2 - contentCenterY * scale;

  const imageRect: PixelRect = {
    x: offsetX,
    y: offsetY,
    width: imageSize.width * scale,
    height: imageSize.height * scale,
  };
  const subjectRect: PixelRect = {
    x: contentBox.x * imageSize.width * scale + offsetX,
    y: contentBox.y * imageSize.height * scale + offsetY,
    width: contentBox.width * imageSize.width * scale,
    height: contentBox.height * imageSize.height * scale,
  };

  const crop = input.crop ?? FULL_CROP;
  const frameWidth = crop.width * imageSize.width;
  const frameHeight = crop.height * imageSize.height;
  const frameCenter: NormalizedPoint = {
    x: offsetX + (crop.x + crop.width / 2) * imageSize.width * scale,
    y: offsetY + (crop.y + crop.height / 2) * imageSize.height * scale,
  };

  let polygonPoints: NormalizedPoint[] | null = null;
  let clipPolygon: NormalizedPoint[] | null = null;
  if (input.polygon) {
    const clipped = clipPolygonToRect(input.polygon, crop);
    if (clipped.length >= 3) {
      polygonPoints = clipped.map((point) => ({
        x: point.x * imageSize.width * scale + offsetX,
        y: point.y * imageSize.height * scale + offsetY,
      }));
      // Fabric local space: origin at the object center, one unit per source
      // pixel (the crop frame spans [-frame/2, +frame/2]).
      clipPolygon = clipped.map((point) => ({
        x: (point.x - crop.x) * imageSize.width - frameWidth / 2,
        y: (point.y - crop.y) * imageSize.height - frameHeight / 2,
      }));
    }
  }

  return {
    scale,
    imageRect,
    subjectRect,
    frameCenter,
    polygonPoints,
    clipPolygon,
  };
}

function positiveRound(value: number): number {
  return Math.max(1, Math.round(value));
}

/**
 * Restores treatment semantics lost by serializeCanvasLayout (core), which
 * hardcodes fit "cover" and drops `treatment` while serializing the Fabric
 * objects' crop-frame rectangles.
 *
 * For "full" items only the fit/treatment flags are restored — the serialized
 * rectangle already is the contained content. For "cutout" items the slot
 * rectangle is rewritten to the subject polygon's bounding box on canvas so
 * re-applying the layout re-derives the same contain placement instead of
 * compounding zoom. The serialized rectangle covers the crop frame only, so
 * the full-image rect is reconstructed first (frame rect minus the crop
 * origin, divided by the crop extent); the subject bbox then maps through
 * it. This is the exact inverse of computeSlotPlacement, making the
 * serialize/merge round-trip idempotent, cropped or not.
 */
export function mergeSerializedTreatments(
  serialized: WallpaperLayout,
  previous: WallpaperLayout,
  polygonByAssetId: ReadonlyMap<string, NormalizedPoint[]>,
): WallpaperLayout {
  const previousById = new Map(
    previous.items.map((item) => [item.id, item]),
  );

  const items = serialized.items.map<WallpaperItem>((item) => {
    const previousItem = previousById.get(item.id);
    if (!previousItem) {
      return item;
    }
    if (previousItem.treatment === "full") {
      return { ...item, fit: "contain", treatment: "full" };
    }
    if (previousItem.treatment !== "cutout") {
      return item;
    }

    const polygon = polygonByAssetId.get(item.assetId);
    if (!polygon) {
      // No subject mask: keep the serialized frame rectangle as the contain
      // content — "cutout without a mask" degrades to "full".
      return { ...item, fit: "contain", treatment: "cutout" };
    }
    const crop = item.crop ?? FULL_CROP;
    const contentBox = contentBoxOf({
      slot: { x: item.x, y: item.y, width: item.width, height: item.height },
      imageSize: { width: 1, height: 1 },
      crop,
      polygon,
    });
    if (!contentBox) {
      return { ...item, fit: "contain", treatment: "cutout" };
    }

    // Full-image rect on canvas: the serialized rect is the crop frame.
    const imageWidth = item.width / crop.width;
    const imageHeight = item.height / crop.height;
    const imageX = item.x - crop.x * imageWidth;
    const imageY = item.y - crop.y * imageHeight;

    return {
      ...item,
      x: Math.round(imageX + contentBox.x * imageWidth),
      y: Math.round(imageY + contentBox.y * imageHeight),
      width: positiveRound(contentBox.width * imageWidth),
      height: positiveRound(contentBox.height * imageHeight),
      fit: "contain",
      treatment: "cutout",
    };
  });

  return { ...serialized, items };
}
