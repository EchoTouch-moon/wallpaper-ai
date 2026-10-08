import assert from "node:assert/strict";
import test from "node:test";

import {
  clipPolygonToRect,
  computeSlotPlacement,
  containScale,
  mergeSerializedTreatments,
  polygonBBox,
  subjectPolygonOf,
} from "./cutoutGeometry.ts";

const closeTo = (actual, expected, epsilon = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );

const rectContains = (outer, inner) =>
  inner.x >= outer.x - 1e-9 &&
  inner.y >= outer.y - 1e-9 &&
  inner.x + inner.width <= outer.x + outer.width + 1e-9 &&
  inner.y + inner.height <= outer.y + outer.height + 1e-9;

const squarePolygon = (x, y, size) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

// ---------------------------------------------------------------------------
// subjectPolygonOf — validation of the analysis -> polygon handoff
// ---------------------------------------------------------------------------

test("subjectPolygonOf returns the polygon for a valid contour", () => {
  const polygon = subjectPolygonOf({
    subjectContour: {
      grid: "1".repeat(256),
      gridSize: 16,
      subjectPolygon: squarePolygon(0.2, 0.1, 0.5),
    },
  });
  assert.equal(polygon?.length, 4);
  assert.deepEqual(polygon[0], { x: 0.2, y: 0.1 });
});

test("subjectPolygonOf rejects missing, short, and out-of-range polygons", () => {
  assert.equal(subjectPolygonOf(undefined), null);
  assert.equal(subjectPolygonOf({}), null);
  assert.equal(
    subjectPolygonOf({
      subjectContour: { grid: "1".repeat(256), gridSize: 16 },
    }),
    null,
  );
  assert.equal(
    subjectPolygonOf({
      subjectContour: {
        grid: "1".repeat(256),
        gridSize: 16,
        subjectPolygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      },
    }),
    null,
  );
  // Out-of-range vertices are dropped; two valid ones remain -> null.
  assert.equal(
    subjectPolygonOf({
      subjectContour: {
        grid: "1".repeat(256),
        gridSize: 16,
        subjectPolygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.4, y: 0.1 },
          { x: 1.4, y: 0.4 },
        ],
      },
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// polygonBBox / clipPolygonToRect
// ---------------------------------------------------------------------------

test("polygonBBox spans the polygon's extremes", () => {
  const bbox = polygonBBox([
    { x: 0.25, y: 0.5 },
    { x: 0.75, y: 0.125 },
    { x: 0.5, y: 0.875 },
  ]);
  assert.deepEqual(bbox, { x: 0.25, y: 0.125, width: 0.5, height: 0.75 });
  assert.equal(polygonBBox([]), null);
});

test("clipPolygonToRect keeps an inside polygon and trims an overhanging one", () => {
  const inside = squarePolygon(0.2, 0.2, 0.3);
  assert.deepEqual(clipPolygonToRect(inside, { x: 0, y: 0, width: 1, height: 1 }), inside);

  const cropped = clipPolygonToRect(
    squarePolygon(0.5, 0.5, 0.5),
    { x: 0, y: 0, width: 0.75, height: 1 },
  );
  // Right edge becomes x = 0.75; every vertex sits inside the rect.
  for (const point of cropped) {
    assert.ok(point.x <= 0.75 + 1e-9, `vertex x ${point.x} exceeds 0.75`);
  }
  closeTo(Math.max(...cropped.map((point) => point.x)), 0.75);
  assert.ok(cropped.length >= 3);
});

test("clipPolygonToRect degrades a fully outside polygon below 3 points", () => {
  const outside = clipPolygonToRect(
    squarePolygon(0.8, 0.8, 0.15),
    { x: 0, y: 0, width: 0.5, height: 0.5 },
  );
  assert.ok(outside.length < 3);
});

// ---------------------------------------------------------------------------
// containScale / computeSlotPlacement — fit semantics
// ---------------------------------------------------------------------------

test("containScale picks the binding axis and never crops the content", () => {
  closeTo(containScale(800, 400, 200, 200), 2); // height-bound
  closeTo(containScale(400, 800, 200, 200), 2); // width-bound
  closeTo(containScale(600, 600, 200, 100), 3); // height-bound
  assert.equal(containScale(0, 100, 10, 10), 0);
  assert.equal(containScale(100, 100, 0, 10), 0);
});

test("cutout placement contain-fits the subject polygon into the slot", () => {
  // 2000x1000 source, subject is a 1000x500 px region on the centered right.
  const polygon = squarePolygon(0.5, 0.25, 0.5);
  const placement = computeSlotPlacement({
    slot: { x: 100, y: 200, width: 320, height: 240 },
    imageSize: { width: 2000, height: 1000 },
    polygon,
  });
  assert.ok(placement);

  // Contain in 320x240 is width-bound: 320/1000 < 240/500 -> scale 0.32,
  // subject renders 320x160 with vertical letterboxing inside the slot.
  closeTo(placement.scale, 0.32);
  closeTo(placement.subjectRect.width, 320, 1e-6);
  closeTo(placement.subjectRect.height, 160, 1e-6);
  // Subject rect fully inside the slot and centered on both axes.
  assert.ok(rectContains(
    { x: 100, y: 200, width: 320, height: 240 },
    placement.subjectRect,
  ));
  closeTo(
    placement.subjectRect.x + placement.subjectRect.width / 2,
    100 + 160,
    1e-6,
  );
  closeTo(
    placement.subjectRect.y + placement.subjectRect.height / 2,
    200 + 120,
    1e-6,
  );
  // Uniform scale (aspect preserved, nothing stretched).
  closeTo(placement.imageRect.width / 2000, placement.scale, 1e-12);
  closeTo(placement.imageRect.height / 1000, placement.scale, 1e-12);
});

test("mapped canvas polygon stays glued to the image rect", () => {
  const polygon = [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.75, y: 0.75 },
    { x: 0.25, y: 0.75 },
  ];
  const placement = computeSlotPlacement({
    slot: { x: 0, y: 0, width: 900, height: 900 },
    imageSize: { width: 600, height: 400 },
    polygon,
  });
  assert.ok(placement?.polygonPoints);
  for (let index = 0; index < polygon.length; index += 1) {
    closeTo(
      placement.polygonPoints[index].x,
      placement.imageRect.x + polygon[index].x * placement.imageRect.width,
      1e-6,
    );
    closeTo(
      placement.polygonPoints[index].y,
      placement.imageRect.y + polygon[index].y * placement.imageRect.height,
      1e-6,
    );
  }
});

test("full treatment (no polygon) contains the whole frame in the slot", () => {
  const placement = computeSlotPlacement({
    slot: { x: 50, y: 60, width: 400, height: 200 },
    imageSize: { width: 1000, height: 500 },
  });
  assert.ok(placement);
  assert.equal(placement.polygonPoints, null);
  assert.equal(placement.clipPolygon, null);
  closeTo(placement.scale, 0.4);
  assert.deepEqual(placement.subjectRect, placement.imageRect);
  closeTo(placement.imageRect.width, 400);
  closeTo(placement.imageRect.height, 200);
  closeTo(placement.imageRect.x, 50);
  closeTo(placement.imageRect.y, 60);
});

test("crop maps polygon and clip coordinates through the crop frame", () => {
  // Subject extends past the crop box: the visible content is the intersection.
  const polygon = squarePolygon(0.2, 0, 0.6);
  const crop = { x: 0.4, y: 0.1, width: 0.4, height: 0.8 };
  const placement = computeSlotPlacement({
    slot: { x: 0, y: 0, width: 400, height: 400 },
    imageSize: { width: 1000, height: 1000 },
    crop,
    polygon,
  });
  assert.ok(placement);

  // Clipped content box: x in [0.4, 0.8], y in [0.1, 0.6] -> 400x500 source px
  // contain-fitted into the 400x400 slot (height-bound).
  closeTo(placement.scale, 400 / 500, 1e-12);
  // Clip polygon local coords: origin at the crop-frame center (frame =
  // 400x800 source px centered on the object), y grows downward. Polygon y
  // spans [0.1, 0.6] -> [0, 500] frame px -> [-400, +100] local.
  const clip = placement.clipPolygon;
  assert.ok(clip);
  const ys = clip.map((point) => point.y);
  closeTo(Math.max(...ys), 100, 1e-9);
  closeTo(Math.min(...ys), -400, 1e-9);
  const xs = clip.map((point) => point.x);
  closeTo(Math.min(...xs), -200, 1e-9);
  closeTo(Math.max(...xs), 200, 1e-9);
  // frameCenter sits at the canvas position of the crop frame's center.
  closeTo(placement.frameCenter.x, placement.imageRect.x + 0.6 * placement.imageRect.width, 1e-9);
  closeTo(placement.frameCenter.y, placement.imageRect.y + 0.5 * placement.imageRect.height, 1e-9);
});

test("degenerate inputs return null instead of a placement", () => {
  assert.equal(
    computeSlotPlacement({
      slot: { x: 0, y: 0, width: 100, height: 100 },
      imageSize: { width: 100, height: 100 },
      polygon: squarePolygon(1.2, 1.2, 0.2), // fully outside the full-frame crop
    }),
    null,
  );
  assert.equal(
    computeSlotPlacement({
      slot: { x: 0, y: 0, width: 0, height: 100 },
      imageSize: { width: 100, height: 100 },
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// mergeSerializedTreatments — editor round-trip after serializeCanvasLayout
// ---------------------------------------------------------------------------

const cutoutLayout = () => ({
  version: "1.0",
  canvas: {
    width: 1000,
    height: 1000,
    ratio: "1:1",
    usage: "desktop",
    backgroundColor: "#101418",
  },
  template: undefined,
  items: [
    {
      id: "layout_1_hero",
      assetId: "asset_a",
      slotId: "hero",
      role: "hero",
      x: 100,
      y: 100,
      width: 500,
      height: 500,
      rotation: 0,
      zIndex: 0,
      opacity: 1,
      fit: "contain",
      treatment: "cutout",
      mask: undefined,
      style: undefined,
    },
    {
      id: "layout_1_support",
      assetId: "asset_b",
      slotId: "support",
      role: "support",
      x: 650,
      y: 100,
      width: 250,
      height: 500,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      fit: "cover",
      treatment: "crop",
      crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
      mask: undefined,
      style: undefined,
    },
    {
      id: "layout_1_band",
      assetId: "asset_c",
      slotId: "band",
      role: "support",
      x: 100,
      y: 650,
      width: 800,
      height: 250,
      rotation: 0,
      zIndex: 2,
      opacity: 1,
      fit: "contain",
      treatment: "full",
      mask: undefined,
      style: undefined,
    },
  ],
  safeAreas: [],
  guidance: {
    intent: "single-hero",
    visualFlow: "center-out",
    transition: { type: "clean-gap", strength: 0.5, feather: 0 },
    boundary: { type: "clean-gap", gap: 12, radius: 0, width: 0 },
    preserveFaces: true,
    preserveNegativeSpace: true,
  },
  notes: [],
});

/** Mimics serializeCanvasLayout's output for a cutout object: the Fabric
 * frame is the full source image, so the serialized rect is the image rect
 * and fit/treatment fall back to "cover"/"crop". */
const serializeLikeCore = (layout, placement) =>
  ({
    ...layout,
    items: layout.items.map((item) =>
      item.treatment === "cutout"
        ? {
            ...item,
            x: Math.round(placement.imageRect.x),
            y: Math.round(placement.imageRect.y),
            width: Math.round(placement.imageRect.width),
            height: Math.round(placement.imageRect.height),
            fit: "cover",
            treatment: "crop",
          }
        : item,
    ),
  });

const polygonByAssetId = new Map([["asset_a", squarePolygon(0.25, 0.25, 0.5)]]);

test("mergeSerializedTreatments rewrites cutout slots to subject rects", () => {
  const previous = cutoutLayout();
  // First placement from the generated layout (slot = 500x500 at 100,100).
  const placement = computeSlotPlacement({
    slot: { x: 100, y: 100, width: 500, height: 500 },
    imageSize: { width: 2000, height: 2000 },
    polygon: polygonByAssetId.get("asset_a"),
  });
  assert.ok(placement);

  const serialized = serializeLikeCore(previous, placement);
  const merged = mergeSerializedTreatments(serialized, previous, polygonByAssetId);

  const hero = merged.items[0];
  assert.equal(hero.treatment, "cutout");
  assert.equal(hero.fit, "contain");
  // Subject is the centered 50% square of the image: a 1000x1000 source px
  // area contain-fitted into the 500x500 slot -> exactly the slot rect.
  assert.equal(hero.x, Math.round(placement.subjectRect.x));
  assert.equal(hero.y, Math.round(placement.subjectRect.y));
  assert.equal(hero.width, Math.round(placement.subjectRect.width));
  assert.equal(hero.height, Math.round(placement.subjectRect.height));

  // crop stays untouched; full only restores flags; crop stays as-is.
  assert.equal(merged.items[1].fit, "cover");
  assert.equal(merged.items[1].treatment, "crop");
  assert.equal(merged.items[2].fit, "contain");
  assert.equal(merged.items[2].treatment, "full");
  assert.equal(merged.items[2].x, 100);
  assert.equal(merged.items[2].width, 800);
});

test("mergeSerializedTreatments is idempotent across serialize cycles", () => {
  const previous = cutoutLayout();
  const slot = { x: 100, y: 100, width: 500, height: 500 };
  const imageSize = { width: 2000, height: 2000 };
  const polygon = polygonByAssetId.get("asset_a");

  const firstPlacement = computeSlotPlacement({ slot, imageSize, polygon });
  assert.ok(firstPlacement);
  const first = mergeSerializedTreatments(
    serializeLikeCore(previous, firstPlacement),
    previous,
    polygonByAssetId,
  );

  // Re-apply the merged layout, then serialize again: the fabric frame is
  // again the full image, and the merge must land on the same subject rect.
  const secondPlacement = computeSlotPlacement({
    slot: {
      x: first.items[0].x,
      y: first.items[0].y,
      width: first.items[0].width,
      height: first.items[0].height,
    },
    imageSize,
    polygon,
  });
  assert.ok(secondPlacement);
  const second = mergeSerializedTreatments(
    serializeLikeCore(first, secondPlacement),
    first,
    polygonByAssetId,
  );

  assert.deepEqual(second.items[0], first.items[0]);
});

test("cutout without a subject polygon degrades to contain, geometry kept", () => {
  const previous = cutoutLayout();
  const serialized = serializeLikeCore(previous, {
    imageRect: { x: 0, y: 0, width: 500, height: 500 },
  });
  const merged = mergeSerializedTreatments(serialized, previous, new Map());
  const hero = merged.items[0];
  assert.equal(hero.treatment, "cutout");
  assert.equal(hero.fit, "contain");
  assert.equal(hero.x, 0);
  assert.equal(hero.width, 500);
});

test("cutout with a crop maps the subject rect through the crop frame", () => {
  const crop = { x: 0.25, y: 0, width: 0.5, height: 1 };
  const polygon = squarePolygon(0.25, 0.25, 0.5); // intersects crop on x [0.25, 0.75]
  const previous = cutoutLayout();
  previous.items[0].crop = { ...crop };

  // Placement from the slot: content = polygon ∩ crop = x [0.25,0.75] (1000
  // source px wide), y [0.25,0.75]; slot 500x500, image 2000x2000 -> scale
  // 0.5, imageRect 1000x1000, frame = 1000x2000 source px -> 500x1000 canvas.
  const placement = computeSlotPlacement({
    slot: { x: 100, y: 100, width: 500, height: 500 },
    imageSize: { width: 2000, height: 2000 },
    crop,
    polygon,
  });
  assert.ok(placement);

  // Core serialization yields the FRAME rect: x = imageRect.x + crop.x*imageW.
  const frameRect = {
    x: placement.imageRect.x + crop.x * placement.imageRect.width,
    y: placement.imageRect.y + crop.y * placement.imageRect.height,
    width: crop.width * placement.imageRect.width,
    height: crop.height * placement.imageRect.height,
  };
  const serialized = {
    ...previous,
    items: previous.items.map((item) =>
      item.id === "layout_1_hero"
        ? {
            ...item,
            x: Math.round(frameRect.x),
            y: Math.round(frameRect.y),
            width: Math.round(frameRect.width),
            height: Math.round(frameRect.height),
            fit: "cover",
            treatment: "crop",
            crop: { ...crop },
          }
        : item,
    ),
  };

  const merged = mergeSerializedTreatments(serialized, previous, polygonByAssetId);
  const hero = merged.items[0];
  // Subject rect must be derived through the full-image rect, not the frame:
  // subject occupies x [0.25, 0.75] and y [0.25, 0.75] of the 1000x1000 image
  // rect centered on the slot -> exactly the 500x500 slot again.
  assert.equal(hero.treatment, "cutout");
  assert.equal(hero.fit, "contain");
  assert.equal(hero.x, 100);
  assert.equal(hero.y, 100);
  assert.equal(hero.width, 500);
  assert.equal(hero.height, 500);
});

test("items unknown to the previous layout pass through unchanged", () => {
  const previous = cutoutLayout();
  const serialized = {
    ...serializeLikeCore(previous, {
      imageRect: { x: 0, y: 0, width: 500, height: 500 },
    }),
    items: [
      ...serializeLikeCore(previous, {
        imageRect: { x: 0, y: 0, width: 500, height: 500 },
      }).items,
      {
        id: "object_free",
        assetId: "asset_z",
        role: "support",
        x: 10,
        y: 10,
        width: 80,
        height: 80,
        rotation: 0,
        zIndex: 3,
        opacity: 1,
        fit: "cover",
        treatment: "crop",
        crop: { x: 0, y: 0, width: 1, height: 1 },
        mask: undefined,
        style: undefined,
      },
    ],
  };
  const merged = mergeSerializedTreatments(serialized, previous, polygonByAssetId);
  assert.equal(merged.items.at(-1).id, "object_free");
  assert.equal(merged.items.at(-1).fit, "cover");
});
