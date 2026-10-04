import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  binarizeMask,
  boxIoU,
  createLocalVision,
  decodeYuNetDetections,
  isLocalVisionEnabled,
  LocalVisionUnavailableError,
  maskAreaRatio,
  maskBoundingBox,
  maskCentroid,
  normalizeProbabilityMap,
  poolMaskToGrid,
  traceMaskPolygon,
} from "./localVision.ts";

// ---------------------------------------------------------------------------
// Synthetic helpers — every test below runs on constructed arrays only; no
// model file, no network, no onnxruntime import.
// ---------------------------------------------------------------------------

function squareMask(size, isSet) {
  const mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      mask[y * size + x] = isSet(x, y) ? 1 : 0;
    }
  }
  return mask;
}

async function tinyPngBuffer() {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    .png()
    .toBuffer();
}

test("binarizeMask thresholds strictly above 0.5", () => {
  const mask = binarizeMask([0.49, 0.5, 0.51, 1]);
  assert.deepEqual(Array.from(mask), [0, 0, 1, 1]);
  assert.deepEqual(Array.from(binarizeMask([0.9], 0.8)), [1]);
});

test("normalizeProbabilityMap passes through [0,1] maps and sigmoids logits", () => {
  const passthrough = normalizeProbabilityMap([0, 0.25, 0.9, 1]);
  assert.equal(passthrough.length, 4);
  // Values round through float32, so compare with float32 tolerance.
  assert.ok(Math.abs(passthrough[1] - 0.25) < 1e-7);
  assert.ok(Math.abs(passthrough[2] - 0.9) < 1e-7);

  const sigmoided = normalizeProbabilityMap([-6, 0, 6]);
  assert.ok(Math.abs(sigmoided[0] - 0.0024726) < 1e-6);
  assert.ok(Math.abs(sigmoided[1] - 0.5) < 1e-9);
  assert.ok(Math.abs(sigmoided[2] - 0.9975273) < 1e-6);
});

test("maskAreaRatio counts set cells over the total", () => {
  assert.equal(maskAreaRatio(new Uint8Array([1, 0, 1, 1])), 0.75);
  assert.equal(maskAreaRatio(new Uint8Array(0)), 0);
});

test("maskBoundingBox uses the inclusive pixel extent convention", () => {
  // 10x10 mask with the rectangle x 2..6, y 3..7.
  const mask = squareMask(10, (x, y) => x >= 2 && x <= 6 && y >= 3 && y <= 7);
  assert.deepEqual(maskBoundingBox(mask, 10), {
    x: 0.2,
    y: 0.3,
    width: 0.5,
    height: 0.5,
  });
  assert.equal(maskBoundingBox(new Uint8Array(100), 10), null);
});

test("maskCentroid averages set-pixel centers; empty masks yield null", () => {
  // Pixel centers 2.5..6.5 average to 4.5 -> 0.45; 3.5..7.5 -> 5.5 -> 0.55.
  const mask = squareMask(10, (x, y) => x >= 2 && x <= 6 && y >= 3 && y <= 7);
  assert.deepEqual(maskCentroid(mask, 10), { x: 0.45, y: 0.55 });

  // A single set pixel at (0, 0) contributes its own center.
  const single = new Uint8Array(100);
  single[0] = 1;
  assert.deepEqual(maskCentroid(single, 10), { x: 0.05, y: 0.05 });

  assert.equal(maskCentroid(new Uint8Array(100), 10), null);
});

test("isLocalVisionEnabled defaults to on and only 'false' disables it", () => {
  assert.equal(isLocalVisionEnabled({}), true);
  assert.equal(isLocalVisionEnabled({ LOCAL_VISION_ENABLED: "true" }), true);
  assert.equal(isLocalVisionEnabled({ LOCAL_VISION_ENABLED: undefined }), true);
  assert.equal(isLocalVisionEnabled({ LOCAL_VISION_ENABLED: "false" }), false);
});

test("poolMaskToGrid pools an exactly divisible mask by majority coverage", () => {
  // 48x48 mask with the top half set: every grid row maps to 2 mask rows.
  const mask = squareMask(48, (_x, y) => y < 24);
  const grid = poolMaskToGrid(mask, 48, 24);
  assert.match(grid, /^[01]{576}$/);
  assert.equal(grid, "1".repeat(24 * 12) + "0".repeat(24 * 12));
});

test("poolMaskToGrid allocates fractional cells by pixel center", () => {
  // 10x10 mask with the left half set; 24 cells over 10 pixels means most
  // cells own a fractional slice and several own none at all. Pixel centers
  // (v + 0.5) * 24 / 10 map v = 0..9 to cells 1, 3, 6, 8, 10, 13, 15, 18,
  // 20, 22 on each axis, so occupied rows and columns both follow that map.
  const mask = squareMask(10, (x) => x < 5);
  const occupiedColumns = [1, 3, 6, 8, 10]; // x = 0..4 only
  const occupiedRows = [1, 3, 6, 8, 10, 13, 15, 18, 20, 22]; // y = 0..9
  const patternRow = Array.from({ length: 24 }, () => "0");
  for (const column of occupiedColumns) {
    patternRow[column] = "1";
  }
  const emptyRow = "0".repeat(24);
  const expected = Array.from({ length: 24 }, (_, row) =>
    occupiedRows.includes(row) ? patternRow.join("") : emptyRow,
  ).join("");
  assert.equal(poolMaskToGrid(mask, 10, 24), expected);
});

test("full synthetic mask pipeline: grid, bbox, ratio and polygon agree", () => {
  // 1024x1024 probability map with a vertical band x 256..767 (exactly half
  // the width, full height) — the ISNet output shape.
  const size = 1024;
  const probabilities = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 256; x < 768; x += 1) {
      probabilities[y * size + x] = 1;
    }
  }
  const mask = binarizeMask(probabilities);

  assert.equal(maskAreaRatio(mask), 0.5);
  assert.deepEqual(maskBoundingBox(mask, size), {
    x: 0.25,
    y: 0,
    width: 0.5,
    height: 1,
  });
  // Band pixel centers 256.5..767.5 fall in columns 6..17 of 24.
  assert.equal(
    poolMaskToGrid(mask, size, 24),
    ("0".repeat(6) + "1".repeat(12) + "0".repeat(6)).repeat(24),
  );

  const polygon = traceMaskPolygon(mask, size, 48);
  assert.ok(polygon !== null);
  assert.equal(polygon.length, 4);
  const corners = [
    { x: 0.25, y: 0 },
    { x: 0.75, y: 0 },
    { x: 0.75, y: 1 },
    { x: 0.25, y: 1 },
  ];
  for (const corner of corners) {
    assert.ok(
      polygon.some(
        (point) =>
          Math.abs(point.x - corner.x) < 1e-9 &&
          Math.abs(point.y - corner.y) < 1e-9,
      ),
      `expected corner ${JSON.stringify(corner)} in ${JSON.stringify(polygon)}`,
    );
  }
});

test("traceMaskPolygon returns the rectangle corners for a block mask", () => {
  const mask = squareMask(10, (x, y) => x >= 2 && x <= 6 && y >= 3 && y <= 7);
  const polygon = traceMaskPolygon(mask, 10, 48);
  assert.ok(polygon !== null);
  assert.equal(polygon.length, 4);
  const corners = [
    { x: 0.2, y: 0.3 },
    { x: 0.7, y: 0.3 },
    { x: 0.7, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];
  for (const corner of corners) {
    assert.ok(
      polygon.some(
        (point) =>
          Math.abs(point.x - corner.x) < 1e-9 &&
          Math.abs(point.y - corner.y) < 1e-9,
      ),
      `expected corner ${JSON.stringify(corner)} in ${JSON.stringify(polygon)}`,
    );
  }
});

test("traceMaskPolygon caps vertices for a large round mask", () => {
  const size = 256;
  const radius = 100;
  const mask = squareMask(size, (x, y) => {
    const dx = x - 128;
    const dy = y - 128;
    return dx * dx + dy * dy <= radius * radius;
  });
  const polygon = traceMaskPolygon(mask, size, 48);
  assert.ok(polygon !== null);
  assert.ok(polygon.length >= 8, `expected a rounder shape, got ${polygon.length} vertices`);
  assert.ok(polygon.length <= 48);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  // Set pixels span x 28..228 inclusive; the traced crack contour reaches
  // the outer pixel edges, i.e. 201/256 = 0.78515625. Simplification may
  // shave corners but should not collapse the shape.
  assert.ok(width > 0.7 && width <= 201 / 256 + 1e-9, `width ${width}`);
  assert.ok(height > 0.7 && height <= 201 / 256 + 1e-9, `height ${height}`);
});

test("traceMaskPolygon returns null for an empty mask", () => {
  assert.equal(traceMaskPolygon(new Uint8Array(64), 8, 48), null);
});

test("boxIoU computes known overlaps", () => {
  const a = { x: 0, y: 0, width: 0.5, height: 0.5 };
  // Half-width overlap: inter 0.125, union 0.375.
  assert.equal(
    boxIoU(a, { x: 0.25, y: 0, width: 0.5, height: 0.5 }),
    1 / 3,
  );
  assert.equal(boxIoU(a, { x: 0.6, y: 0.6, width: 0.2, height: 0.2 }), 0);
  // Nested box: intersection is the smaller box (0.16), so IoU is 0.16/0.25.
  assert.ok(
    Math.abs(boxIoU(a, { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }) - 0.64) <
      1e-12,
  );
});

test("decodeYuNetDetections decodes, clamps, thresholds and NMS-suppresses", () => {
  // Single stride-8 level on a 640x640 canvas holding 640x360 content.
  const cells = 80 * 80;
  const cls = new Float32Array(cells);
  const obj = new Float32Array(cells);
  const bbox = new Float32Array(cells * 4);

  const setCell = (row, col, clsScore, objScore, loc0, loc1, wLog, hLog) => {
    const index = row * 80 + col;
    cls[index] = clsScore;
    obj[index] = objScore;
    bbox[index * 4 + 0] = loc0;
    bbox[index * 4 + 1] = loc1;
    bbox[index * 4 + 2] = wLog;
    bbox[index * 4 + 3] = hLog;
  };

  // Detection A (kept, score 1): cell (10, 20) -> center (160, 80), size
  // 64x96 in canvas pixels -> x 0.2, y (80-48)/360, w 64/640, h 96/360.
  setCell(10, 20, 1, 1, 0, 0, Math.log(8), Math.log(12));
  // Detection B (suppressed by NMS, score 0.9): same size shifted one cell
  // right -> IoU 0.78 against A.
  setCell(10, 21, 0.9, 0.9, 0, 0, Math.log(8), Math.log(12));
  // Detection C (below the 0.5 score threshold): score sqrt(0.4*0.4) = 0.4.
  setCell(30, 30, 0.4, 0.4, 0, 0, Math.log(8), Math.log(12));
  // Detection D (kept after clamping, score 0.8): cell (40, 0) -> center
  // (0, 320), 64x64 -> raw x1 = -0.05 clamps to 0.
  setCell(40, 0, 0.8, 0.8, 0, 0, Math.log(8), Math.log(8));

  const boxes = decodeYuNetDetections(
    [{ cls, obj, bbox }],
    {
      inputSize: 640,
      contentWidth: 640,
      contentHeight: 360,
      strides: [8],
    },
  );

  assert.equal(boxes.length, 2);
  const [first, second] = boxes;
  // Tensor values round through float32 (as real ONNX outputs do), so
  // compare with float32-scale tolerance.
  const tolerance = 1e-6;
  assert.ok(Math.abs(first.score - 1) < tolerance);
  assert.ok(Math.abs(first.x - 0.2) < tolerance);
  assert.ok(Math.abs(first.y - 32 / 360) < tolerance);
  assert.ok(Math.abs(first.width - 0.1) < tolerance);
  assert.ok(Math.abs(first.height - 96 / 360) < tolerance);

  assert.ok(Math.abs(second.score - 0.8) < tolerance);
  assert.equal(second.x, 0);
  assert.ok(Math.abs(second.y - 288 / 360) < tolerance);
  assert.ok(Math.abs(second.width - 0.05) < tolerance);
  assert.ok(Math.abs(second.height - 64 / 360) < tolerance);
});

test("missing model files throw LocalVisionUnavailableError", async () => {
  const modelsDirectory = await mkdtemp(path.join(tmpdir(), "local-vision-empty-"));
  const image = await tinyPngBuffer();
  try {
    const vision = createLocalVision({ modelsDirectory });
    await assert.rejects(
      vision.detectFaces(image, "image/png"),
      (error) =>
        error instanceof LocalVisionUnavailableError &&
        error.name === "LocalVisionUnavailableError" &&
        error.code === "local_vision_unavailable" &&
        error.message.includes("fetch-vision-models"),
    );
    await assert.rejects(
      vision.extractSubjectContour(image, "image/png"),
      (error) => error instanceof LocalVisionUnavailableError,
    );
    // A failed load is not cached: the same instance can retry later (the
    // second call fails the same way instead of, say, hanging or crashing).
    await assert.rejects(
      vision.detectFaces(image, "image/png"),
      (error) => error instanceof LocalVisionUnavailableError,
    );
  } finally {
    await rm(modelsDirectory, { recursive: true, force: true });
  }
});

test("LOCAL_VISION_ENABLED=false skips inference entirely", async () => {
  const modelsDirectory = await mkdtemp(path.join(tmpdir(), "local-vision-off-"));
  const image = await tinyPngBuffer();
  try {
    const vision = createLocalVision({
      modelsDirectory,
      environment: { LOCAL_VISION_ENABLED: "false" },
    });
    // The model directory is empty; skipping must not even try to load.
    assert.deepEqual(await vision.detectFaces(image, "image/png"), []);
    assert.equal(await vision.extractSubjectContour(image, "image/png"), null);
  } finally {
    await rm(modelsDirectory, { recursive: true, force: true });
  }
});

test("invalid inputs are rejected before any model work", async () => {
  const modelsDirectory = await mkdtemp(path.join(tmpdir(), "local-vision-bad-"));
  const image = await tinyPngBuffer();
  try {
    const vision = createLocalVision({ modelsDirectory });
    await assert.rejects(
      vision.detectFaces(image, "text/plain"),
      (error) => error instanceof TypeError,
    );
    await assert.rejects(
      vision.extractSubjectContour("not-a-buffer", "image/png"),
      (error) => error instanceof TypeError,
    );
  } finally {
    await rm(modelsDirectory, { recursive: true, force: true });
  }
});
