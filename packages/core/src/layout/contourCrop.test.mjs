import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCoverCrop,
} from "./planTemplate.ts";
import {
  applyCropIntent,
  resolveCropFocus,
} from "./compileTemplateRecipe.ts";
import { imageAssetAnalysisSchema } from "./layoutSchema.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function analysis(extra = {}) {
  return {
    assetId: "asset",
    width: 2000,
    height: 1000,
    orientation: "landscape",
    aspectRatio: 2,
    resolutionScore: 0.9,
    dominantColors: ["#112233", "#223344", "#334455"],
    averageColor: "#223344",
    brightness: 0.5,
    saturation: 0.4,
    contrast: 0.4,
    ...extra,
  };
}

function contourGrid(gridSize, occupiedTest) {
  let cells = "";
  for (let row = 0; row < gridSize; row++) {
    for (let column = 0; column < gridSize; column++) {
      cells += occupiedTest(row, column) ? "1" : "0";
    }
  }
  return cells;
}

/**
 * Byte-for-byte replica of the pre-contour calculateCoverCrop (git HEAD,
 * planTemplate.ts@52-113). The identity assertions below compare against it
 * to guarantee analyses without faces/subjectContour crop identically.
 */
function legacyCoverCrop(analysisData, slotWidth, slotHeight) {
  const clamp = (value, minimum = 0, maximum = 1) =>
    Math.min(Math.max(value, minimum), maximum);
  const sourceAspect = analysisData.aspectRatio;
  const targetAspect = slotWidth / slotHeight;
  const faceCenter =
    analysisData.faces && analysisData.faces.length > 0
      ? {
          x:
            analysisData.faces.reduce(
              (total, face) => total + face.x + face.width / 2,
              0,
            ) / analysisData.faces.length,
          y:
            analysisData.faces.reduce(
              (total, face) => total + face.y + face.height / 2,
              0,
            ) / analysisData.faces.length,
        }
      : null;
  const subjectCenter = analysisData.subjectBox
    ? {
        x: analysisData.subjectBox.x + analysisData.subjectBox.width / 2,
        y: analysisData.subjectBox.y + analysisData.subjectBox.height / 2,
      }
    : null;
  const focalPoint =
    faceCenter ??
    subjectCenter ??
    analysisData.saliencyCenter ?? { x: 0.5, y: 0.5 };

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
    analysisData.orientation === "portrait" && targetAspect > 1;
  const fallbackY = isPortraitInLandscape
    ? (1 - height) * 0.35
    : (1 - height) / 2;
  const y =
    faceCenter || subjectCenter || analysisData.saliencyCenter
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

const approxEqual = (actual, expected, epsilon = 1e-9) =>
  Math.abs(actual - expected) <= epsilon;

// ---------------------------------------------------------------------------
// Level 4 — identity with the legacy clamp path (baseline guard)
// ---------------------------------------------------------------------------

test("analyses without faces/subjectContour crop bit-for-bit like the legacy path", () => {
  const scenarios = [
    // landscape source, sliding x — subjectBox / saliency / bare / both
    [
      "landscape+subjectBox",
      analysis({ subjectBox: { x: 0.05, y: 0.2, width: 0.2, height: 0.6 } }),
      [500, 1000],
    ],
    [
      "landscape+saliency",
      analysis({ saliencyCenter: { x: 0.8, y: 0.3 } }),
      [500, 1000],
    ],
    ["landscape+bare", analysis(), [1000, 1000]],
    ["landscape+square-slot", analysis({ saliencyCenter: { x: 0.9, y: 0.1 } }), [1000, 1000]],
    // portrait source, sliding y — with and without the 0.35 portrait bias
    [
      "portrait+subject",
      analysis({
        width: 1000,
        height: 2000,
        orientation: "portrait",
        aspectRatio: 0.5,
        subjectBox: { x: 0.3, y: 0.05, width: 0.4, height: 0.2 },
      }),
      [1000, 1000],
    ],
    [
      "portrait-in-landscape-bias",
      analysis({
        width: 1000,
        height: 2000,
        orientation: "portrait",
        aspectRatio: 0.5,
      }),
      [1000, 500],
    ],
    [
      // saliency near the top edge exercises the lower clamp bound (y → 0).
      "portrait-clamp-lower-bound",
      analysis({
        width: 1000,
        height: 2000,
        orientation: "portrait",
        aspectRatio: 0.5,
        saliencyCenter: { x: 0.5, y: 0.05 },
      }),
      [1000, 500],
    ],
    [
      // saliency near the bottom edge exercises the upper clamp bound.
      "portrait-clamp-upper-bound",
      analysis({
        width: 1000,
        height: 2000,
        orientation: "portrait",
        aspectRatio: 0.5,
        saliencyCenter: { x: 0.5, y: 0.97 },
      }),
      [1000, 500],
    ],
    // square source slides y; equal aspects collapse to a single position
    ["square-source", analysis({ width: 1000, height: 1000, aspectRatio: 1 }), [1000, 1000]],
    ["ultrawide", analysis({ aspectRatio: 3 }), [600, 400]],
  ];

  const optionSets = [
    undefined,
    {},
    { focus: "subject" },
    { focus: "saliency" },
    { focus: "center" },
    { focus: "faces" },
    { focus: "contour" },
    { zoom: "tight" },
    { focus: { x: 0.7, y: 0.2 } },
  ];

  for (const [label, analysisData, [slotWidth, slotHeight]] of scenarios) {
    const expected = legacyCoverCrop(analysisData, slotWidth, slotHeight);
    for (const options of optionSets) {
      assert.deepEqual(
        calculateCoverCrop(analysisData, slotWidth, slotHeight, options),
        expected,
        `${label} with options ${JSON.stringify(options)} must match the legacy crop`,
      );
    }
    // Default call shape (no options argument at all) stays byte-identical.
    assert.deepEqual(
      calculateCoverCrop(analysisData, slotWidth, slotHeight),
      expected,
      `${label} without options must match the legacy crop`,
    );
  }
});

test("a subjectContour with an all-zero grid or a malformed grid falls back to the legacy path", () => {
  const base = analysis({ saliencyCenter: { x: 0.2, y: 0.4 } });
  const expected = legacyCoverCrop(base, 500, 1000);
  assert.deepEqual(
    calculateCoverCrop(
      { ...base, subjectContour: { grid: "0".repeat(256), gridSize: 16 } },
      500,
      1000,
    ),
    expected,
    "all-zero grid carries no signal and must not move the window",
  );
  assert.deepEqual(
    calculateCoverCrop(
      // gridSize 8 with a matching 64-cell grid is out of the 16-64 contract;
      // the crop solver defensively ignores it (the schema rejects it earlier).
      { ...base, subjectContour: { grid: "1".repeat(64), gridSize: 8 } },
      500,
      1000,
    ),
    expected,
    "out-of-contract grid sizes must be ignored, not crash",
  );
  assert.deepEqual(
    calculateCoverCrop(
      { ...base, subjectContour: { grid: "1".repeat(255), gridSize: 16 } },
      500,
      1000,
    ),
    expected,
    "grid length not equal to gridSize squared must be ignored",
  );
});

// ---------------------------------------------------------------------------
// Level 1 — hard face-union constraint
// ---------------------------------------------------------------------------

test("faces near the top of a tall image pull the narrow window up off the legacy crop that cut them", () => {
  // Portrait source (aspect 0.5) into a square slot: the window covers half
  // the height and slides along y. Big face on top [0.02, 0.12] (area 0.01),
  // small face lower [0.55, 0.60] (area 0.005).
  const data = analysis({
    width: 1000,
    height: 2000,
    orientation: "portrait",
    aspectRatio: 0.5,
    faces: [
      { x: 0.45, y: 0.02, width: 0.1, height: 0.1 },
      { x: 0.45, y: 0.55, width: 0.1, height: 0.05 },
    ],
  });

  const legacy = legacyCoverCrop(data, 1000, 1000);
  // Legacy clamps on the mean face center (0.3225): window [0.0725, 0.5725]
  // slices the top off the big face AND the bottom off the small one.
  assert.ok(legacy.y > 0.02, "legacy crop must cut the top face (test premise)");
  assert.ok(legacy.y + 0.5 < 0.6, "legacy crop must cut the lower face (test premise)");

  const upgraded = calculateCoverCrop(data, 1000, 1000);
  // The padded union (span 0.58 + 2×0.058 = 0.696) cannot fit into 0.5, so
  // the area-weighted containment picks the window that fully keeps the big
  // face: [0.02, 0.52].
  assert.ok(
    approxEqual(upgraded.y, 0.02),
    `expected y≈0.02, got ${upgraded.y}`,
  );
  assert.ok(upgraded.y < legacy.y, "window must move up relative to legacy");
  assert.ok(
    upgraded.y <= 0.02 + 1e-9 && upgraded.y + 0.5 >= 0.12 - 1e-9,
    "big face must be fully contained",
  );
  assert.ok(approxEqual(upgraded.height, 0.5));
  assert.ok(approxEqual(upgraded.focalPoint.y, 0.3225), "focalPoint metadata keeps the mean face center");
});

test("when the padded face union fits, the window contains it fully", () => {
  // Landscape source (aspect 4) into a square slot: window width 0.25 slides
  // along x. Face union [0.7, 0.85], padded to [0.6825, 0.8675] (span 0.185).
  const data = analysis({
    aspectRatio: 4,
    faces: [{ x: 0.7, y: 0.3, width: 0.15, height: 0.2 }],
  });
  const crop = calculateCoverCrop(data, 1000, 1000);
  assert.ok(approxEqual(crop.width, 0.25));
  assert.ok(
    crop.x <= 0.6825 + 1e-9 && crop.x + crop.width >= 0.8675 - 1e-9,
    `window [${crop.x}, ${crop.x + crop.width}] must contain the padded face union`,
  );
  // Centered placement: ideal offset clamps to (0.775 - 0.125) = 0.65.
  assert.ok(approxEqual(crop.x, 0.65));
});

test("when nothing fits, weighted containment prefers fully keeping the large face over straddling", () => {
  // Two far-apart faces: big [0, 0.2] (area 0.02), small [0.8, 0.9] (area
  // 0.005). Window 0.25 cannot cover both; the area-weighted optimum fully
  // contains the big face at x=0 (weighted score 0.004 beats the small face
  // 0.0005 and any straddling window).
  const data = analysis({
    aspectRatio: 4,
    faces: [
      { x: 0.0, y: 0.3, width: 0.2, height: 0.1 },
      { x: 0.8, y: 0.3, width: 0.1, height: 0.05 },
    ],
  });
  const crop = calculateCoverCrop(data, 1000, 1000);
  assert.ok(approxEqual(crop.x, 0), `expected x≈0, got ${crop.x}`);
  assert.ok(
    crop.x <= 0 + 1e-9 && crop.x + crop.width >= 0.2 - 1e-9,
    "large face must be fully contained",
  );
  // Directional contrast: the legacy mean-center clamp lands at 0.35 where
  // the window covers neither face at all.
  const legacy = legacyCoverCrop(data, 1000, 1000);
  assert.ok(approxEqual(legacy.x, 0.35));
  const overlap = (crop, start, end) =>
    Math.max(0, Math.min(end, crop.x + crop.width) - Math.max(start, crop.x));
  assert.ok(overlap(crop, 0, 0.2) > overlap(legacy, 0, 0.2));
});

test('focus: "contour" demotes faces to the contour/polygon target', () => {
  const data = analysis({
    aspectRatio: 2,
    faces: [{ x: 0.1, y: 0.3, width: 0.1, height: 0.2 }],
    subjectContour: {
      grid: contourGrid(16, (row, column) => column >= 12),
      gridSize: 16,
    },
  });
  const faceDriven = calculateCoverCrop(data, 1000, 1000);
  const contourDriven = calculateCoverCrop(data, 1000, 1000, {
    focus: "contour",
  });
  // Default: faces win — window centered on the left-hand face.
  assert.ok(faceDriven.x < 0.2);
  // focus contour: grid columns 12..15 (centers ∈ [0.78125, 0.96875]) must
  // be fully retained — the window slides right and keeps every cell.
  assert.ok(
    contourDriven.x > faceDriven.x,
    `contour focus must move the window right, got ${contourDriven.x}`,
  );
  for (let column = 12; column <= 15; column++) {
    const center = (column + 0.5) / 16;
    assert.ok(
      center >= contourDriven.x - 1e-9 &&
        center <= contourDriven.x + contourDriven.width + 1e-9,
      `occupied center ${center} fell outside the contour-driven window`,
    );
  }
});

// ---------------------------------------------------------------------------
// Level 2 — polygon overlap maximization
// ---------------------------------------------------------------------------

test("a right-half subject polygon slides the window right (directional)", () => {
  const data = analysis({
    aspectRatio: 2,
    subjectContour: {
      grid: contourGrid(16, () => false),
      gridSize: 16,
      subjectPolygon: [
        { x: 0.6, y: 0.2 },
        { x: 0.95, y: 0.5 },
        { x: 0.6, y: 0.8 },
      ],
    },
  });
  const legacy = legacyCoverCrop(data, 1000, 1000);
  assert.ok(approxEqual(legacy.x, 0.25), "no-signal legacy centers the window");

  const crop = calculateCoverCrop(data, 1000, 1000);
  assert.ok(
    crop.x > legacy.x,
    `window must move right toward the polygon, got x=${crop.x}`,
  );
  // The whole triangle fits inside the window — the overlap-maximal placement
  // (ties between equivalent full-containment windows break toward the legacy
  // clamp, so assert containment, not one exact offset).
  assert.ok(
    crop.x <= 0.6 + 1e-9 && crop.x + crop.width >= 0.95 - 1e-9,
    `window [${crop.x}, ${crop.x + crop.width}] must contain the polygon`,
  );
});

test("a bottom-half polygon on a portrait source slides the window down", () => {
  const data = analysis({
    width: 1000,
    height: 2000,
    orientation: "portrait",
    aspectRatio: 0.5,
    subjectContour: {
      grid: contourGrid(16, () => false),
      gridSize: 16,
      subjectPolygon: [
        { x: 0.3, y: 0.6 },
        { x: 0.7, y: 0.6 },
        { x: 0.5, y: 0.95 },
      ],
    },
  });
  const crop = calculateCoverCrop(data, 1000, 1000);
  assert.ok(approxEqual(crop.height, 0.5));
  assert.ok(crop.y > 0.175, "window must move down off the no-signal legacy bias");
  assert.ok(
    crop.y <= 0.6 + 1e-9 && crop.y + crop.height >= 0.95 - 1e-9,
    `window [${crop.y}, ${crop.y + crop.height}] must contain the polygon`,
  );
});

test("when the polygon cannot fit, the window hugs the thick side (max intersection)", () => {
  // Triangle with its thick base at x=0.3 and tip at x=0.9; window width 0.25
  // (source aspect 2, slot 500×1000 → target 0.5). The intersection area is
  // maximized by flushing the left edge with the base vertex.
  const data = analysis({
    aspectRatio: 2,
    subjectContour: {
      grid: contourGrid(16, () => false),
      gridSize: 16,
      subjectPolygon: [
        { x: 0.3, y: 0.3 },
        { x: 0.9, y: 0.5 },
        { x: 0.3, y: 0.7 },
      ],
    },
  });
  const crop = calculateCoverCrop(data, 500, 1000);
  assert.ok(approxEqual(crop.width, 0.25));
  assert.ok(approxEqual(crop.x, 0.3), `expected x≈0.3, got ${crop.x}`);

  // Directional check against the legacy center clamp (0.375): the chosen
  // window must cover strictly more polygon area.
  const polygonIntersection = (x) => {
    // Exact area of triangle ∩ [x, x + 0.25] via the width-integral of the
    // triangle's vertical thickness (base 0.4 at x=0.3 tapering to 0 at 0.9).
    const a = Math.max(0.3, x);
    const b = Math.min(0.9, x + 0.25);
    if (b <= a) return 0;
    // Antiderivative of the thickness: 0.4t - (t-0.3)^2 / 3
    const F = (t) => 0.4 * t - ((t - 0.3) ** 2) / 3;
    return F(b) - F(a);
  };
  assert.ok(
    polygonIntersection(crop.x) > polygonIntersection(0.375) + 1e-9,
    "chosen window must beat the legacy centered window on intersection area",
  );
});

// ---------------------------------------------------------------------------
// Level 3 — occupancy-grid retention fallback
// ---------------------------------------------------------------------------

test("grid-only contours maximize retained occupied cells (right-biased subject)", () => {
  const data = analysis({
    aspectRatio: 2,
    subjectContour: {
      grid: contourGrid(16, (row, column) => column >= 8),
      gridSize: 16,
    },
  });
  const legacy = legacyCoverCrop(data, 1000, 1000);
  assert.ok(approxEqual(legacy.x, 0.25));

  const crop = calculateCoverCrop(data, 1000, 1000);
  assert.ok(approxEqual(crop.width, 0.5));
  assert.ok(
    crop.x > legacy.x,
    `window must move right toward the occupied cells, got ${crop.x}`,
  );
  // Occupied centers live in [0.53125, 0.96875]; the maximal-retention window
  // keeps all 128 cells (equivalent full-retention offsets tie toward the
  // legacy clamp, so assert containment of every center).
  for (let column = 8; column <= 15; column++) {
    const center = (column + 0.5) / 16;
    assert.ok(
      center >= crop.x - 1e-9 && center <= crop.x + crop.width + 1e-9,
      `occupied center ${center} fell outside [${crop.x}, ${crop.x + crop.width}]`,
    );
  }
});

test("grid retention cannot cover every occupied cell, so it maximizes the count deterministically", () => {
  // Occupied columns 4..11 → centers [0.28125, 0.71875]; window 0.5 covers
  // the span (0.4375) fully for any offset in [0.21875, 0.28125].
  const data = analysis({
    aspectRatio: 2,
    subjectContour: {
      grid: contourGrid(16, (row, column) => column >= 4 && column <= 11),
      gridSize: 16,
    },
  });
  const crop = calculateCoverCrop(data, 1000, 1000);
  assert.ok(
    crop.x >= 0.21875 - 1e-9 && crop.x <= 0.28125 + 1e-9,
    `expected the full-retention plateau, got x=${crop.x}`,
  );
  // Every occupied center must sit inside the chosen window.
  for (let column = 4; column <= 11; column++) {
    const center = (column + 0.5) / 16;
    assert.ok(
      center >= crop.x - 1e-9 && center <= crop.x + crop.width + 1e-9,
      `center ${center} fell outside the window [${crop.x}, ${crop.x + crop.width}]`,
    );
  }
});

test("grid retention on the y axis honors a vertically biased subject", () => {
  const data = analysis({
    width: 1000,
    height: 2000,
    orientation: "portrait",
    aspectRatio: 0.5,
    subjectContour: {
      grid: contourGrid(24, (row) => row >= 18),
      gridSize: 24,
    },
  });
  const crop = calculateCoverCrop(data, 1000, 1000);
  assert.ok(approxEqual(crop.height, 0.5));
  assert.ok(crop.y > 0.175, "window must move down off the no-signal bias");
  // Occupied row centers live in [18.5/24, 23.5/24] ≈ [0.7708, 0.9792]; the
  // maximal-retention window keeps all of them.
  for (let row = 18; row <= 23; row++) {
    const center = (row + 0.5) / 24;
    assert.ok(
      center >= crop.y - 1e-9 && center <= crop.y + crop.height + 1e-9,
      `occupied center ${center} fell outside [${crop.y}, ${crop.y + crop.height}]`,
    );
  }
});

// ---------------------------------------------------------------------------
// Slot-intent focus plumbing (compileTemplateRecipe)
// ---------------------------------------------------------------------------

test("applyCropIntent passes faces/contour windows through with refreshed focal points", () => {
  const base = analysis({
    aspectRatio: 2,
    faces: [{ x: 0.7, y: 0.3, width: 0.15, height: 0.2 }],
  });
  const coverCrop = calculateCoverCrop(base, 1000, 1000, {
    focus: "faces",
    zoom: "tight",
  });
  // zoom tight shrinks the sliding window to 0.5 × 0.8 = 0.4.
  assert.ok(approxEqual(coverCrop.width, 0.4));

  const result = applyCropIntent(
    coverCrop,
    { focus: "faces", zoom: "tight" },
    base,
  );
  assert.ok(result, "faces focus must not be treated as inert");
  assert.deepEqual(
    { x: result.x, y: result.y, width: result.width, height: result.height },
    { x: coverCrop.x, y: coverCrop.y, width: coverCrop.width, height: coverCrop.height },
    "window placement stays exactly what calculateCoverCrop resolved",
  );
  assert.ok(approxEqual(result.focalPoint.x, 0.775));
  assert.ok(approxEqual(result.focalPoint.y, 0.4));

  const contourAnalysis = analysis({
    aspectRatio: 2,
    subjectContour: {
      grid: contourGrid(16, () => false),
      gridSize: 16,
      subjectPolygon: [
        { x: 0.6, y: 0.2 },
        { x: 0.95, y: 0.5 },
        { x: 0.6, y: 0.8 },
      ],
    },
  });
  const contourCrop = calculateCoverCrop(contourAnalysis, 1000, 1000, {
    focus: "contour",
  });
  const contourResult = applyCropIntent(
    contourCrop,
    { focus: "contour" },
    contourAnalysis,
  );
  assert.ok(contourResult);
  assert.deepEqual(
    { x: contourResult.x, width: contourResult.width },
    { x: contourCrop.x, width: contourCrop.width },
  );
  // Polygon centroid: ((0.6 + 0.95 + 0.6) / 3, (0.2 + 0.5 + 0.8) / 3).
  assert.ok(approxEqual(contourResult.focalPoint.x, 0.7166666667));
  assert.ok(approxEqual(contourResult.focalPoint.y, 0.5));
});

test("legacy focus values keep flowing through applyCropIntent unchanged", () => {
  const base = analysis({
    aspectRatio: 2,
    subjectBox: { x: 0.6, y: 0.2, width: 0.3, height: 0.5 },
  });
  const coverCrop = calculateCoverCrop(base, 1000, 1000);
  const result = applyCropIntent(coverCrop, { focus: "subject" }, base);
  // Subject center 0.75, window width 0.5 → clamp(0.75 − 0.25) = 0.5.
  assert.ok(approxEqual(result.x, 0.5));
  assert.ok(approxEqual(result.focalPoint.x, 0.75));
  // Inert intents still return null.
  assert.equal(applyCropIntent(coverCrop, {}, base), null);
  assert.equal(
    applyCropIntent(coverCrop, { zoom: "standard" }, base),
    null,
  );
});

test("resolveCropFocus resolves faces and contour with signal fallbacks", () => {
  const faceAnalysis = analysis({
    faces: [
      { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      { x: 0.5, y: 0.4, width: 0.2, height: 0.2 },
    ],
  });
  // Mean face center: x = (0.2 + 0.6) / 2 = 0.4, y = (0.2 + 0.5) / 2 = 0.35.
  const faceFocus = resolveCropFocus("faces", faceAnalysis);
  assert.ok(approxEqual(faceFocus.x, 0.4));
  assert.ok(approxEqual(faceFocus.y, 0.35));
  // No faces → falls back through subjectBox/saliency/center.
  assert.deepEqual(
    resolveCropFocus("faces", analysis({ saliencyCenter: { x: 0.2, y: 0.8 } })),
    { x: 0.2, y: 0.8 },
  );
  assert.deepEqual(resolveCropFocus("faces", analysis()), { x: 0.5, y: 0.5 });

  const gridAnalysis = analysis({
    subjectContour: {
      grid: contourGrid(16, (row, column) => row === 0 && column < 4),
      gridSize: 16,
    },
  });
  // Occupied centers x ∈ {(0.5, 1.5, 2.5, 3.5)/16}, y = 0.5/16.
  assert.deepEqual(resolveCropFocus("contour", gridAnalysis), {
    x: 0.125,
    y: 0.03125,
  });
  assert.deepEqual(resolveCropFocus("contour", analysis()), { x: 0.5, y: 0.5 });
});

// ---------------------------------------------------------------------------
// Schema boundaries (layoutSchema / templateRecipe)
// ---------------------------------------------------------------------------

test("imageAssetAnalysisSchema accepts a well-formed subjectContour", () => {
  const base = analysis({
    subjectContour: {
      grid: contourGrid(24, (row, column) => row + column < 10),
      gridSize: 24,
      subjectPolygon: [
        { x: 0.1, y: 0.1 },
        { x: 0.4, y: 0.2 },
        { x: 0.3, y: 0.6 },
      ],
      subjectAreaRatio: 0.18,
    },
  });
  const parsed = imageAssetAnalysisSchema.safeParse(base);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.subjectContour.subjectAreaRatio, 0.18);
  // subjectAreaRatio is optional on the consumer side.
  const noRatio = imageAssetAnalysisSchema.safeParse({
    ...base,
    subjectContour: {
      grid: contourGrid(16, () => false),
      gridSize: 16,
    },
  });
  assert.ok(noRatio.success);
});

test("imageAssetAnalysisSchema rejects malformed subjectContour and oversized faces", () => {
  const cases = [
    {
      label: "grid with non-binary characters",
      contour: { grid: "012".padEnd(256, "0"), gridSize: 16 },
    },
    {
      label: "gridSize below 16",
      contour: { grid: "0".repeat(64), gridSize: 8 },
    },
    {
      label: "gridSize above 64",
      contour: { grid: "0".repeat(65 * 65), gridSize: 65 },
    },
    {
      label: "grid length ≠ gridSize²",
      contour: { grid: "0".repeat(255), gridSize: 16 },
    },
    {
      label: "polygon beyond 48 vertices",
      contour: {
        grid: contourGrid(16, () => false),
        gridSize: 16,
        subjectPolygon: Array.from({ length: 49 }, (_, index) => ({
          x: 0.01 * index,
          y: 0.5,
        })),
      },
    },
    {
      label: "polygon below 3 vertices",
      contour: {
        grid: contourGrid(16, () => false),
        gridSize: 16,
        subjectPolygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.4 },
        ],
      },
    },
    {
      label: "gridSize non-integer",
      contour: { grid: "0".repeat(256), gridSize: 16.5 },
    },
  ];
  for (const { label, contour } of cases) {
    const parsed = imageAssetAnalysisSchema.safeParse(
      analysis({ subjectContour: contour }),
    );
    assert.equal(parsed.success, false, `expected rejection: ${label}`);
  }

  const thirteenFaces = Array.from({ length: 13 }, (_, index) => ({
    x: 0.01 * index,
    y: 0.2,
    width: 0.05,
    height: 0.05,
  }));
  assert.equal(
    imageAssetAnalysisSchema.safeParse(analysis({ faces: thirteenFaces }))
      .success,
    false,
    "more than 12 faces must be rejected",
  );
  assert.equal(
    imageAssetAnalysisSchema.safeParse(
      analysis({ faces: thirteenFaces.slice(0, 12) }),
    ).success,
    true,
    "exactly 12 faces stay valid",
  );
});
