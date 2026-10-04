import { access } from "node:fs/promises";
import path from "node:path";

import type { InferenceSession } from "onnxruntime-node";
import sharp from "sharp";

// Local ONNX vision pipeline productized from the spikes in temp/spike/
// (face-spike.mjs -> YuNet, contour-spike.mjs -> ISNet-general-use; selection
// rationale and measured numbers live in the spike record).
//
// Everything that turns model tensors into the layout contract (grid /
// polygon / bbox / ratio / face boxes) is a pure exported function so it can
// be unit-tested on synthetic data without any model file. The ONNX sessions
// themselves are created lazily per process, and a missing model file throws
// LocalVisionUnavailableError instead of crashing the caller.

export const FACE_DETECTION_SCORE_THRESHOLD = 0.5;
export const FACE_DETECTION_IOU_THRESHOLD = 0.3;

export const CONTOUR_GRID_SIZE = 24;
export const CONTOUR_MAX_POLYGON_VERTICES = 48;

const YUNET_MODEL_FILE = "yunet_2023mar.onnx";
const YUNET_INPUT_SIZE = 640;
const YUNET_STRIDES = [8, 16, 32];

const ISNET_MODEL_FILE = "isnet-general-use.onnx";
const ISNET_INPUT_SIZE = 1024;
// rembg sessions/dis_general_use.py normalization constants.
const ISNET_CHANNEL_MEAN = [0.5, 0.5, 0.5];
const ISNET_CHANNEL_STD = [1, 1, 1];

const MASK_PROBABILITY_THRESHOLD = 0.5;
// A probability map whose values already span [0, 1] is treated as sigmoided
// by the model; logits outside that range get an external sigmoid (same
// runtime check as the contour spike, guarding against double sigmoid).
const PROBABILITY_RANGE_TOLERANCE = 1e-3;

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedFaceBox extends NormalizedBox {
  score: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface LocalSubjectContour {
  /** 24x24 occupancy grid flattened row-major: exactly 576 chars of 0/1. */
  grid: string;
  gridSize: typeof CONTOUR_GRID_SIZE;
  /** Up to 48 normalized vertices of the largest subject contour, if any. */
  subjectPolygon?: NormalizedPoint[];
  /** Share of mask pixels classified as subject (0-1). */
  subjectAreaRatio: number;
  /** Normalized bounding box of the subject mask; null for an empty mask. */
  subjectBox: NormalizedBox | null;
  /**
   * Centroid of the subject mask (mean of set-pixel centers), used as the
   * authoritative saliencyCenter; null for an empty mask.
   */
  saliencyCenter: NormalizedPoint | null;
}

/**
 * Thrown when a local vision model file is missing (or unreadable) at the
 * point a caller actually asks for inference. Callers are expected to catch
 * this name/code and degrade gracefully.
 */
export class LocalVisionUnavailableError extends Error {
  readonly code = "local_vision_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "LocalVisionUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Pure mask post-processing (grid / polygon / bbox / ratio)
// ---------------------------------------------------------------------------

/**
 * Passes through a probability map that already lies in [0, 1] and applies a
 * sigmoid otherwise, so callers never double-sigmoid an already-sigmoided
 * output (which would mark the whole image as foreground).
 */
export function normalizeProbabilityMap(raw: ArrayLike<number>): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i];
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }
  if (min >= -PROBABILITY_RANGE_TOLERANCE && max <= 1 + PROBABILITY_RANGE_TOLERANCE) {
    return Float32Array.from(raw);
  }
  return Float32Array.from(raw, (value) => 1 / (1 + Math.exp(-value)));
}

/** Strict-threshold binarization: mask[i] = 1 iff probabilities[i] > threshold. */
export function binarizeMask(
  probabilities: ArrayLike<number>,
  threshold: number = MASK_PROBABILITY_THRESHOLD,
): Uint8Array {
  const mask = new Uint8Array(probabilities.length);
  for (let i = 0; i < probabilities.length; i += 1) {
    mask[i] = probabilities[i] > threshold ? 1 : 0;
  }
  return mask;
}

/** Share of set cells: foreground count / total cells. */
export function maskAreaRatio(mask: Uint8Array): number {
  if (mask.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    count += mask[i];
  }
  return count / mask.length;
}

/**
 * Normalized bounding box of the set cells, in the inclusive-pixel-extent
 * convention used by the contour spike: a single set pixel at (x, y) has
 * width and height 1/maskSize.
 */
export function maskBoundingBox(
  mask: Uint8Array,
  maskSize: number,
): NormalizedBox | null {
  let minX = maskSize;
  let minY = maskSize;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < maskSize; y += 1) {
    for (let x = 0; x < maskSize; x += 1) {
      if (mask[y * maskSize + x] !== 0) {
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  return {
    x: minX / maskSize,
    y: minY / maskSize,
    width: (maxX - minX + 1) / maskSize,
    height: (maxY - minY + 1) / maskSize,
  };
}

/**
 * Mean of the set-pixel centers of a square binary mask, in normalized
 * coordinates (a set pixel at (x, y) contributes ((x+0.5)/size, ...)); null
 * for an empty mask. This is the local layer's saliencyCenter.
 */
export function maskCentroid(
  mask: Uint8Array,
  maskSize: number,
): NormalizedPoint | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < maskSize; y += 1) {
    for (let x = 0; x < maskSize; x += 1) {
      if (mask[y * maskSize + x] !== 0) {
        sumX += x + 0.5;
        sumY += y + 0.5;
        count += 1;
      }
    }
  }
  if (count === 0) {
    return null;
  }
  return { x: sumX / count / maskSize, y: sumY / count / maskSize };
}

/**
 * Pools a square binary mask into a gridSize x gridSize occupancy string
 * (row-major, 1 = subject cell). Each mask pixel votes for the cell its
 * center falls in; a cell is 1 iff at least half of its pixels are set, so
 * the output is exact for any maskSize (not just multiples of gridSize).
 */
export function poolMaskToGrid(
  mask: Uint8Array,
  maskSize: number,
  gridSize: number = CONTOUR_GRID_SIZE,
): string {
  const hits = new Uint32Array(gridSize * gridSize);
  const totals = new Uint32Array(gridSize * gridSize);
  for (let y = 0; y < maskSize; y += 1) {
    const cellY = Math.min(
      gridSize - 1,
      Math.floor(((y + 0.5) * gridSize) / maskSize),
    );
    for (let x = 0; x < maskSize; x += 1) {
      const cellX = Math.min(
        gridSize - 1,
        Math.floor(((x + 0.5) * gridSize) / maskSize),
      );
      const cell = cellY * gridSize + cellX;
      totals[cell] += 1;
      hits[cell] += mask[y * maskSize + x];
    }
  }
  let grid = "";
  for (let cell = 0; cell < gridSize * gridSize; cell += 1) {
    grid += totals[cell] > 0 && hits[cell] * 2 >= totals[cell] ? "1" : "0";
  }
  return grid;
}

interface GridPoint {
  gx: number;
  gy: number;
}

// Crack-following contour trace over a square binary mask: every unit edge
// between a foreground pixel and a background pixel (or the image border) is
// emitted with a consistent orientation, then chained into closed loops. At
// the only possible junction (two foreground pixels touching at a corner)
// the sharpest clockwise turn is preferred, which keeps diagonal blobs as
// separate tight loops instead of merging them.
function traceContours(
  mask: Uint8Array,
  size: number,
): GridPoint[][] {
  const width = size;
  const height = size;
  const isForeground = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  const pointKey = (gx: number, gy: number): number => gx + gy * (width + 1);
  const outgoing = new Map<number, GridPoint[]>();
  const addEdge = (fromX: number, fromY: number, toX: number, toY: number) => {
    const key = pointKey(fromX, fromY);
    const list = outgoing.get(key);
    if (list === undefined) {
      outgoing.set(key, [{ gx: toX, gy: toY }]);
    } else {
      list.push({ gx: toX, gy: toY });
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isForeground(x, y)) {
        continue;
      }
      if (!isForeground(x, y - 1)) {
        addEdge(x, y, x + 1, y); // top edge, +x
      }
      if (!isForeground(x + 1, y)) {
        addEdge(x + 1, y, x + 1, y + 1); // right edge, +y
      }
      if (!isForeground(x, y + 1)) {
        addEdge(x + 1, y + 1, x, y + 1); // bottom edge, -x
      }
      if (!isForeground(x - 1, y)) {
        addEdge(x, y + 1, x, y); // left edge, -y
      }
    }
  }

  // Clockwise direction cycle in screen coordinates (y grows downward).
  const directionIndex = (dx: number, dy: number): number => {
    if (dx === 1) {
      return 0;
    }
    if (dy === 1) {
      return 1;
    }
    if (dx === -1) {
      return 2;
    }
    return 3; // dy === -1
  };

  const contours: GridPoint[][] = [];
  for (;;) {
    let startKey: number | undefined;
    for (const key of outgoing.keys()) {
      if ((outgoing.get(key) ?? []).length > 0) {
        startKey = key;
        break;
      }
    }
    if (startKey === undefined) {
      break;
    }
    const startList = outgoing.get(startKey) ?? [];
    const startFrom: GridPoint = {
      gx: startKey % (width + 1),
      gy: Math.floor(startKey / (width + 1)),
    };
    const startTo = startList.pop() as GridPoint;

    const contour: GridPoint[] = [startFrom];
    let previous = startFrom;
    let current = startTo;
    while (current.gx !== startFrom.gx || current.gy !== startFrom.gy) {
      contour.push(current);
      const list = outgoing.get(pointKey(current.gx, current.gy));
      let next: GridPoint | undefined;
      if (list !== undefined && list.length > 0) {
        if (list.length === 1) {
          next = list.pop();
        } else {
          const incomingIndex = directionIndex(
            current.gx - previous.gx,
            current.gy - previous.gy,
          );
          let bestRank = 5;
          let bestAt = 0;
          for (let i = 0; i < list.length; i += 1) {
            const candidate = list[i];
            const rank =
              (directionIndex(
                candidate.gx - current.gx,
                candidate.gy - current.gy,
              ) -
                incomingIndex +
                4) %
              4;
            if (rank < bestRank) {
              bestRank = rank;
              bestAt = i;
            }
          }
          next = list.splice(bestAt, 1)[0];
        }
      }
      if (next === undefined) {
        break; // unreachable with consistent edge orientation; guards loops
      }
      previous = current;
      current = next;
    }
    if (contour.length >= 4) {
      contours.push(contour);
    }
  }

  const contourArea = (points: GridPoint[]): number => {
    let twiceArea = 0;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      twiceArea += p.gx * q.gy - q.gx * p.gy;
    }
    return Math.abs(twiceArea) / 2;
  };

  return contours
    .map((contour) => ({ contour, area: contourArea(contour) }))
    .filter((entry) => entry.area >= 1)
    .sort((a, b) => b.area - a.area)
    .map((entry) => entry.contour);
}

function perpendicularDistance(
  point: GridPoint,
  start: GridPoint,
  end: GridPoint,
): number {
  const dx = end.gx - start.gx;
  const dy = end.gy - start.gy;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const ex = point.gx - start.gx;
    const ey = point.gy - start.gy;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const cross =
    (point.gx - start.gx) * dy - (point.gy - start.gy) * dx;
  return Math.abs(cross) / Math.sqrt(lengthSquared);
}

// Iterative Douglas-Peucker over an open point chain (kept endpoints).
function douglasPeucker(points: GridPoint[], epsilon: number): GridPoint[] {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [segmentStart, segmentEnd] = stack.pop() as [number, number];
    let maxDistance = -1;
    let farthest = -1;
    for (let i = segmentStart + 1; i < segmentEnd; i += 1) {
      const distance = perpendicularDistance(
        points[i],
        points[segmentStart],
        points[segmentEnd],
      );
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (maxDistance > epsilon && farthest > 0) {
      keep[farthest] = 1;
      stack.push([segmentStart, farthest], [farthest, segmentEnd]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

// Simplifies a closed ring to at most maxVertices points by splitting it at
// the two farthest-apart vertices and simplifying both open chains, growing
// the epsilon until the vertex budget is met.
function simplifyClosedRing(
  points: GridPoint[],
  maxVertices: number,
): GridPoint[] {
  if (points.length < 3) {
    return points;
  }
  let farthest = 0;
  let bestDistance = -1;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].gx - points[0].gx;
    const dy = points[i].gy - points[0].gy;
    const distance = dx * dx + dy * dy;
    if (distance > bestDistance) {
      bestDistance = distance;
      farthest = i;
    }
  }
  const chainA = points.slice(0, farthest + 1);
  const chainB = [points[farthest], ...points.slice(farthest + 1), points[0]];

  const simplify = (epsilon: number): GridPoint[] => {
    const simplifiedA = douglasPeucker(chainA, epsilon);
    const simplifiedB = douglasPeucker(chainB, epsilon);
    // chainB contributes its interior vertices only; its endpoints are
    // already the ring seam provided by chainA.
    return [...simplifiedA, ...simplifiedB.slice(1, simplifiedB.length - 1)];
  };

  let epsilon = 0.5; // grid units: removes exactly-collinear vertices
  let simplified = simplify(epsilon);
  while (simplified.length > maxVertices) {
    epsilon *= 2;
    simplified = simplify(epsilon);
  }
  if (
    simplified.length > 1 &&
    simplified[0].gx === simplified[simplified.length - 1].gx &&
    simplified[0].gy === simplified[simplified.length - 1].gy
  ) {
    simplified.pop();
  }
  return simplified;
}

/**
 * Traces the largest contour of a square binary mask (marching-squares style
 * crack following + Douglas-Peucker simplification) and returns it as up to
 * maxVertices normalized vertices, or null when the mask has no usable
 * region.
 */
export function traceMaskPolygon(
  mask: Uint8Array,
  maskSize: number,
  maxVertices: number = CONTOUR_MAX_POLYGON_VERTICES,
): NormalizedPoint[] | null {
  const contours = traceContours(mask, maskSize);
  if (contours.length === 0) {
    return null;
  }
  const simplified = simplifyClosedRing(contours[0], maxVertices);
  if (simplified.length < 3) {
    return null;
  }
  return simplified.map((point) => ({
    x: point.gx / maskSize,
    y: point.gy / maskSize,
  }));
}

// ---------------------------------------------------------------------------
// Pure face-detection post-processing (YuNet anchor-free decode + NMS)
// ---------------------------------------------------------------------------

/** Per-stride YuNet output tensors (cls, obj, bbox) as plain number arrays. */
export interface YuNetLevelTensors {
  cls: ArrayLike<number>;
  obj: ArrayLike<number>;
  bbox: ArrayLike<number>;
}

export interface YuNetDecodeOptions {
  /** Padded square input size fed to the model (e.g. 640). */
  inputSize: number;
  /** Resized image extent inside the padded canvas (the un-padded tw/th). */
  contentWidth: number;
  contentHeight: number;
  scoreThreshold?: number;
  iouThreshold?: number;
  strides?: number[];
}

export function boxIoU(a: NormalizedBox, b: NormalizedBox): number {
  const interWidth = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const interHeight = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  const intersection = interWidth * interHeight;
  const union =
    a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function nonMaxSuppression(
  boxes: NormalizedFaceBox[],
  iouThreshold: number,
): NormalizedFaceBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: NormalizedFaceBox[] = [];
  for (const candidate of sorted) {
    if (kept.every((keptBox) => boxIoU(keptBox, candidate) < iouThreshold)) {
      kept.push(candidate);
    }
  }
  return kept;
}

/**
 * Decodes YuNet anchor-free outputs into normalized face boxes: per stride
 * s, cx = (col + loc0) * s, cy = (row + loc1) * s, w = exp(loc2) * s,
 * h = exp(loc3) * s, score = sqrt(cls * obj); boxes are mapped back from the
 * padded canvas to original-image normalized coordinates and deduplicated
 * with NMS. Levels correspond to strides[0..n-1] in order.
 */
export function decodeYuNetDetections(
  levels: YuNetLevelTensors[],
  options: YuNetDecodeOptions,
): NormalizedFaceBox[] {
  const inputSize = options.inputSize;
  const strides = options.strides ?? YUNET_STRIDES;
  const scoreThreshold =
    options.scoreThreshold ?? FACE_DETECTION_SCORE_THRESHOLD;
  const iouThreshold = options.iouThreshold ?? FACE_DETECTION_IOU_THRESHOLD;

  const candidates: NormalizedFaceBox[] = [];
  levels.forEach((level, levelIndex) => {
    const stride = strides[levelIndex] ?? strides[strides.length - 1];
    const cols = inputSize / stride;
    const rows = inputSize / stride;
    const { cls, obj, bbox } = level;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const score = Math.sqrt(
          Math.min(cls[index], 1) * Math.min(obj[index], 1),
        );
        if (score < scoreThreshold) {
          continue;
        }
        const centerX = (col + bbox[index * 4 + 0]) * stride;
        const centerY = (row + bbox[index * 4 + 1]) * stride;
        const width = Math.exp(bbox[index * 4 + 2]) * stride;
        const height = Math.exp(bbox[index * 4 + 3]) * stride;
        const x1 = Math.max(0, (centerX - width / 2) / options.contentWidth);
        const y1 = Math.max(0, (centerY - height / 2) / options.contentHeight);
        const x2 = Math.min(1, (centerX + width / 2) / options.contentWidth);
        const y2 = Math.min(1, (centerY + height / 2) / options.contentHeight);
        candidates.push({
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
          score,
        });
      }
    }
  });
  return nonMaxSuppression(candidates, iouThreshold);
}

// ---------------------------------------------------------------------------
// Session management + public API
// ---------------------------------------------------------------------------

export interface LocalVisionOptions {
  /** Directory holding the ONNX files; defaults to <cwd>/models. */
  modelsDirectory?: string;
  /** Environment override; defaults to process.env. */
  environment?: Record<string, string | undefined>;
}

export interface LocalVision {
  /**
   * Detects faces with YuNet. Returns normalized face boxes (highest score
   * first). Returns [] when local vision is disabled via
   * LOCAL_VISION_ENABLED=false. Throws LocalVisionUnavailableError when the
   * model file is missing.
   */
  detectFaces(buffer: Buffer, mimeType: string): Promise<NormalizedFaceBox[]>;
  /**
   * Segments the subject with ISNet-general-use and post-processes the mask
   * into the contour contract (grid/polygon/bbox/area ratio plus the mask
   * centroid as saliencyCenter). Returns null when local vision is disabled,
   * or a contour with an all-zero grid and null subjectBox/saliencyCenter
   * when the model finds no subject. Throws LocalVisionUnavailableError when
   * the model file is missing.
   */
  extractSubjectContour(
    buffer: Buffer,
    mimeType: string,
  ): Promise<LocalSubjectContour | null>;
}

function assertImageInput(buffer: Buffer, mimeType: string): void {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("localVision expects an image Buffer");
  }
  if (typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
    throw new TypeError(
      `Unsupported mimeType for local vision: ${String(mimeType)}`,
    );
  }
}

/**
 * True unless LOCAL_VISION_ENABLED=false — the shared enablement rule for
 * the local geometry layer, exported so callers (e.g. the upload pipeline)
 * can skip the layer entirely without touching instance internals.
 */
export function isLocalVisionEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.LOCAL_VISION_ENABLED !== "false";
}

export function createLocalVision(
  options: LocalVisionOptions = {},
): LocalVision {
  // The turbopackIgnore comment keeps next build's file tracing from
  // following process.cwd() into the whole project tree (the models/
  // directory only matters at runtime, never in the build output).
  const modelsDirectory =
    options.modelsDirectory ??
    path.join(/*turbopackIgnore: true*/ process.cwd(), "models");
  const environment = options.environment ?? process.env;
  const enabled = (): boolean => isLocalVisionEnabled(environment);

  // Lazy per-instance session cache; a failed load is dropped so a later
  // call can retry (e.g. after the model file has been fetched).
  const sessions = new Map<string, Promise<InferenceSession>>();

  function loadSession(modelFile: string): Promise<InferenceSession> {
    const cached = sessions.get(modelFile);
    if (cached !== undefined) {
      return cached;
    }
    const created = (async () => {
      const modelPath = path.join(modelsDirectory, modelFile);
      try {
        await access(modelPath);
      } catch {
        throw new LocalVisionUnavailableError(
          `Local vision model file is missing: ${modelPath}. Run "node scripts/fetch-vision-models.mjs" to download it, or set LOCAL_VISION_ENABLED=false to skip local vision.`,
        );
      }
      // onnxruntime-node is imported lazily so disabled / model-missing
      // callers never load the native binding.
      const ort = await import(/*turbopackIgnore: true*/ "onnxruntime-node");
      return ort.InferenceSession.create(modelPath);
    })();
    sessions.set(modelFile, created);
    created.catch(() => {
      sessions.delete(modelFile);
    });
    return created;
  }

  async function detectFaces(
    buffer: Buffer,
    mimeType: string,
  ): Promise<NormalizedFaceBox[]> {
    if (!enabled()) {
      return [];
    }
    assertImageInput(buffer, mimeType);
    const session = await loadSession(YUNET_MODEL_FILE);
    const ort = await import(/*turbopackIgnore: true*/ "onnxruntime-node");

    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 1 || height < 1) {
      throw new Error("Cannot detect faces: image has no decodable size");
    }
    // Aspect-preserving resize onto the 640x640 canvas, right/bottom padded
    // with black (same geometry as the face spike).
    const scale = YUNET_INPUT_SIZE / Math.max(width, height);
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const { data: rgb } = await sharp(buffer)
      .resize(tw, th, { fit: "fill" })
      .removeAlpha()
      .toColorspace("srgb")
      .extend({
        right: YUNET_INPUT_SIZE - tw,
        bottom: YUNET_INPUT_SIZE - th,
        background: { r: 0, g: 0, b: 0 },
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const plane = YUNET_INPUT_SIZE * YUNET_INPUT_SIZE;
    const input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i += 1) {
      input[plane + i] = rgb[i * 3 + 1]; // G
      input[2 * plane + i] = rgb[i * 3]; // R
      input[i] = rgb[i * 3 + 2]; // B — OpenCV BGR channel order
    }

    const results = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", input, [
        1,
        3,
        YUNET_INPUT_SIZE,
        YUNET_INPUT_SIZE,
      ]),
    });
    const levels: YuNetLevelTensors[] = YUNET_STRIDES.map((stride) => {
      const cls = results[`cls_${stride}`];
      const obj = results[`obj_${stride}`];
      const bbox = results[`bbox_${stride}`];
      if (cls === undefined || obj === undefined || bbox === undefined) {
        throw new Error(
          `YuNet output tensors missing for stride ${stride} (got ${session.outputNames.join(", ")})`,
        );
      }
      return {
        cls: cls.data as ArrayLike<number>,
        obj: obj.data as ArrayLike<number>,
        bbox: bbox.data as ArrayLike<number>,
      };
    });

    return decodeYuNetDetections(levels, {
      inputSize: YUNET_INPUT_SIZE,
      contentWidth: tw,
      contentHeight: th,
      strides: YUNET_STRIDES,
    });
  }

  async function extractSubjectContour(
    buffer: Buffer,
    mimeType: string,
  ): Promise<LocalSubjectContour | null> {
    if (!enabled()) {
      return null;
    }
    assertImageInput(buffer, mimeType);
    const session = await loadSession(ISNET_MODEL_FILE);
    const ort = await import(/*turbopackIgnore: true*/ "onnxruntime-node");

    const size = ISNET_INPUT_SIZE;
    const plane = size * size;
    // EXIF-rotated, LANCZOS-stretched 1024x1024 sRGB, rembg normalization.
    const { data: rgb } = await sharp(buffer)
      .rotate()
      .resize(size, size, { fit: "fill", kernel: "lanczos3" })
      .removeAlpha()
      .toColorspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });

    const input = new Float32Array(3 * plane);
    for (let channel = 0; channel < 3; channel += 1) {
      const mean = ISNET_CHANNEL_MEAN[channel];
      const std = ISNET_CHANNEL_STD[channel];
      const offset = channel * plane;
      for (let i = 0; i < plane; i += 1) {
        input[offset + i] = (rgb[i * 3 + channel] / 255 - mean) / std;
      }
    }

    const results = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", input, [
        1,
        3,
        size,
        size,
      ]),
    });
    const outputName = session.outputNames[0];
    const output = results[outputName];
    if (output === undefined) {
      throw new Error(
        `ISNet produced no output tensor (expected ${String(outputName)})`,
      );
    }

    const probabilities = normalizeProbabilityMap(
      output.data as ArrayLike<number>,
    );
    const mask = binarizeMask(probabilities);
    const polygon = traceMaskPolygon(mask, size, CONTOUR_MAX_POLYGON_VERTICES);
    return {
      grid: poolMaskToGrid(mask, size, CONTOUR_GRID_SIZE),
      gridSize: CONTOUR_GRID_SIZE,
      ...(polygon !== null ? { subjectPolygon: polygon } : {}),
      subjectAreaRatio: maskAreaRatio(mask),
      subjectBox: maskBoundingBox(mask, size),
      saliencyCenter: maskCentroid(mask, size),
    };
  }

  return { detectFaces, extractSubjectContour };
}

let defaultInstance: LocalVision | null = null;

function getDefaultLocalVision(): LocalVision {
  if (defaultInstance === null) {
    defaultInstance = createLocalVision();
  }
  return defaultInstance;
}

/** Module-level convenience API backed by a lazy default instance. */
export function detectFaces(
  buffer: Buffer,
  mimeType: string,
): Promise<NormalizedFaceBox[]> {
  return getDefaultLocalVision().detectFaces(buffer, mimeType);
}

export function extractSubjectContour(
  buffer: Buffer,
  mimeType: string,
): Promise<LocalSubjectContour | null> {
  return getDefaultLocalVision().extractSubjectContour(buffer, mimeType);
}
