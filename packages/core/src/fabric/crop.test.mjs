import assert from "node:assert/strict";
import test from "node:test";
import { calculateCropFrame, calculateCropPan } from "./crop.ts";

test("centers a square crop in a landscape image", () => {
  const crop = calculateCropFrame(
    { width: 1200, height: 800 },
    1,
    { width: 600, height: 400 },
  );

  assert.deepEqual(
    { width: crop.width, height: crop.height, cropX: crop.cropX, cropY: crop.cropY },
    { width: 800, height: 800, cropX: 200, cropY: 0 },
  );
  assert.ok(crop.scale > 0);
});

test("uses the drag origin instead of accumulating movement", () => {
  const first = calculateCropPan({
    initialCropX: 200,
    initialCropY: 0,
    deltaX: 40,
    deltaY: 0,
    angle: 0,
    scaleX: 0.5,
    scaleY: 0.5,
    original: { width: 1200, height: 800 },
    frame: { width: 800, height: 800 },
  });
  const repeatedEvent = calculateCropPan({
    initialCropX: 200,
    initialCropY: 0,
    deltaX: 40,
    deltaY: 0,
    angle: 0,
    scaleX: 0.5,
    scaleY: 0.5,
    original: { width: 1200, height: 800 },
    frame: { width: 800, height: 800 },
  });

  assert.deepEqual(first, { cropX: 120, cropY: 0 });
  assert.deepEqual(repeatedEvent, first);
});

test("converts canvas drag into rotated image coordinates and clamps it", () => {
  const crop = calculateCropPan({
    initialCropX: 0,
    initialCropY: 200,
    deltaX: 50,
    deltaY: 0,
    angle: 90,
    scaleX: 1,
    scaleY: 1,
    original: { width: 800, height: 1200 },
    frame: { width: 800, height: 800 },
  });

  assert.equal(crop.cropX, 0);
  assert.equal(crop.cropY, 250);
});
