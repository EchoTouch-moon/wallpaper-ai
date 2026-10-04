import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  cleanupExpiredAssets,
  deleteTemporaryAsset,
  getTemporaryAsset,
  readTemporaryAssetContent,
  readTemporaryAssetOriginalBuffer,
  storeTemporaryAsset,
  TemporaryAssetError,
  temporaryAssetPublicView,
} from "./temporaryAssetStore.ts";

async function fixtureFile(
  name = "sample.png",
  mimeType = "image/png",
  color = { r: 70, g: 110, b: 214, alpha: 1 },
) {
  const content = await sharp({
    create: {
      width: 80,
      height: 60,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
  return new File([content], name, { type: mimeType });
}

async function withStore(run) {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "one-touch-asset-test-"),
  );
  try {
    await run(rootDirectory);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

// Local geometry layer stub. Defaults mirror a successful local run; every
// knob (faces/contour results or thrown errors) is overridable per test.
function fakeLocalVision({
  faces = [],
  contour = null,
  faceError = null,
  contourError = null,
} = {}) {
  return {
    async detectFaces() {
      if (faceError) {
        throw faceError;
      }
      return faces;
    },
    async extractSubjectContour() {
      if (contourError) {
        throw contourError;
      }
      return contour;
    },
  };
}

const LOCAL_CONTOUR = {
  grid: "0".repeat(120) + "1".repeat(24) + "0".repeat(432),
  gridSize: 24,
  subjectPolygon: [
    { x: 0.25, y: 0.05 },
    { x: 0.75, y: 0.05 },
    { x: 0.5, y: 0.95 },
  ],
  subjectAreaRatio: 24 / 576,
  subjectBox: { x: 0.25, y: 0.05, width: 0.5, height: 0.9 },
  saliencyCenter: { x: 0.5, y: 0.4 },
};

const SEMANTIC_PATCH = {
  contentType: "pet",
  // Must be ignored: the local layer's mask centroid already won the slot.
  saliencyCenter: { x: 0.9, y: 0.1 },
  styleTags: ["soft", "cat"],
  bestUse: ["hero", "support"],
  cropSafety: "low",
};

function semanticVisionProvider(overrides = {}) {
  return {
    async analyze() {
      return { ...SEMANTIC_PATCH, ...overrides };
    },
  };
}

test("stores, analyzes, thumbnails, and protects a temporary image", async () => {
  await withStore(async (rootDirectory) => {
    const now = new Date("2026-07-06T00:00:00.000Z");
    const record = await storeTemporaryAsset(
      await fixtureFile(),
      undefined,
      { rootDirectory, now, localVision: null },
    );

    assert.equal(record.width, 80);
    assert.equal(record.height, 60);
    assert.equal(record.analysis.orientation, "landscape");
    assert.equal(record.analysisSource, "basic");
    assert.deepEqual(record.analysisWarnings, []);
    assert.equal(record.analysis.dominantColors.length, 3);
    assert.equal(
      record.expiresAt,
      "2026-07-07T00:00:00.000Z",
    );
    assert.deepEqual(
      await getTemporaryAsset(record.id, record.sessionId, {
        rootDirectory,
        now,
      }),
      record,
    );

    const thumbnail = await readTemporaryAssetContent(
      record.id,
      record.accessToken,
      "thumbnail",
      { rootDirectory, now },
    );
    assert.equal(thumbnail.contentType, "image/webp");
    assert.ok(thumbnail.content.length > 0);

    await assert.rejects(
      () =>
        getTemporaryAsset(record.id, crypto.randomUUID(), {
          rootDirectory,
          now,
        }),
      (error) =>
        error instanceof TemporaryAssetError && error.code === "forbidden",
    );
    await assert.rejects(
      () =>
        readTemporaryAssetContent(
          record.id,
          crypto.randomUUID(),
          "original",
          { rootDirectory, now },
        ),
      (error) =>
        error instanceof TemporaryAssetError && error.code === "forbidden",
    );

    const publicView = temporaryAssetPublicView(record);
    assert.match(publicView.thumbnailUrl, /variant=thumbnail/);
    assert.equal("accessToken" in publicView, false);
  });
});

test("merges local geometry with VLM semantics, local geometry always winning", async () => {
  await withStore(async (rootDirectory) => {
    const enriched = await storeTemporaryAsset(
      await fixtureFile("layered.png"),
      undefined,
      {
        rootDirectory,
        localVision: fakeLocalVision({
          faces: [
            { x: 0.35, y: 0.12, width: 0.2, height: 0.24, score: 0.97 },
            { x: 0.6, y: 0.15, width: 0.15, height: 0.18, score: 0.81 },
          ],
          contour: LOCAL_CONTOUR,
        }),
        visionProvider: semanticVisionProvider(),
      },
    );

    assert.equal(enriched.analysisSource, "vision");
    // Geometry comes from the local layer, detection scores stripped.
    assert.deepEqual(enriched.analysis.faces, [
      { x: 0.35, y: 0.12, width: 0.2, height: 0.24 },
      { x: 0.6, y: 0.15, width: 0.15, height: 0.18 },
    ]);
    assert.deepEqual(enriched.analysis.subjectBox, LOCAL_CONTOUR.subjectBox);
    // The core contour schema keeps grid/gridSize/polygon/areaRatio and
    // strips the hoisted subjectBox/saliencyCenter.
    assert.deepEqual(
      enriched.analysis.subjectContour,
      (({ saliencyCenter: _s, subjectBox: _b, ...contour }) => contour)(
        LOCAL_CONTOUR,
      ),
    );
    // Local mask centroid beats the VLM's saliencyCenter fallback.
    assert.deepEqual(enriched.analysis.saliencyCenter, {
      x: 0.5,
      y: 0.4,
    });
    // Semantics come from the VLM and override the pixel-derived defaults
    // (unknown / hero+background+triptych / medium).
    assert.equal(enriched.analysis.contentType, "pet");
    assert.deepEqual(enriched.analysis.styleTags, ["soft", "cat"]);
    assert.deepEqual(enriched.analysis.bestUse, ["hero", "support"]);
    assert.equal(enriched.analysis.cropSafety, "low");
    // Pixel analysis fields are untouched.
    assert.equal(enriched.analysis.dominantColors.length, 3);

    // Both local sub-layers report success with elapsed time.
    assert.equal(enriched.analysisWarnings.length, 2);
    assert.match(
      enriched.analysisWarnings[0],
      /^Local face detection returned 2 face\(s\) in \d+ms\.$/,
    );
    assert.match(
      enriched.analysisWarnings[1],
      /^Local subject segmentation returned a subject contour in \d+ms\.$/,
    );
  });
});

test("keeps local geometry and falls back to derived semantics when the VLM times out", async () => {
  await withStore(async (rootDirectory) => {
    const fallback = await storeTemporaryAsset(
      await fixtureFile("vlm-timeout.png"),
      undefined,
      {
        rootDirectory,
        localVision: fakeLocalVision({ contour: LOCAL_CONTOUR }),
        visionProvider: {
          async analyze() {
            throw new Error("Request timed out after 90000ms");
          },
        },
      },
    );

    assert.equal(fallback.analysisSource, "basic");
    // VLM semantics fall back to the pixel-derived defaults (the fixture is
    // 80x60 landscape -> hero/background/triptych, medium, no styleTags).
    assert.equal(fallback.analysis.contentType, "unknown");
    assert.deepEqual(fallback.analysis.bestUse, [
      "hero",
      "background",
      "triptych",
    ]);
    assert.equal(fallback.analysis.cropSafety, "medium");
    assert.equal(fallback.analysis.styleTags, undefined);
    // Local geometry survives the VLM failure untouched.
    assert.deepEqual(fallback.analysis.subjectBox, LOCAL_CONTOUR.subjectBox);
    assert.deepEqual(fallback.analysis.saliencyCenter, { x: 0.5, y: 0.4 });
    assert.equal(fallback.analysis.subjectContour.grid, LOCAL_CONTOUR.grid);

    // Local success records plus the existing VLM fallback warning, in that
    // order.
    assert.equal(fallback.analysisWarnings.length, 3);
    assert.match(
      fallback.analysisWarnings[0],
      /^Local face detection found no faces in \d+ms\.$/,
    );
    assert.match(
      fallback.analysisWarnings[1],
      /^Local subject segmentation returned a subject contour in \d+ms\.$/,
    );
    assert.match(
      fallback.analysisWarnings[2],
      /^Semantic vision analysis was unavailable; basic image analysis was used\./,
    );
    assert.match(
      fallback.analysisWarnings[2],
      /Reason: Request timed out after 90000ms/,
    );
  });
});

test("a disabled local layer keeps the pre-local-layer pipeline identical", async () => {
  await withStore(async (rootDirectory) => {
    // VLM success: semantics merge exactly as before the local layer
    // existed, the VLM saliencyCenter fills the geometry gap, and no local
    // warning is recorded.
    const withVision = await storeTemporaryAsset(
      await fixtureFile("identical-vision.png"),
      undefined,
      {
        rootDirectory,
        localVision: null,
        visionProvider: semanticVisionProvider(),
      },
    );
    assert.equal(withVision.analysisSource, "vision");
    assert.equal(withVision.analysis.contentType, "pet");
    assert.deepEqual(withVision.analysis.styleTags, ["soft", "cat"]);
    assert.deepEqual(withVision.analysis.saliencyCenter, { x: 0.9, y: 0.1 });
    assert.equal(withVision.analysis.faces, undefined);
    assert.equal(withVision.analysis.subjectBox, undefined);
    assert.equal(withVision.analysis.subjectContour, undefined);
    assert.deepEqual(withVision.analysisWarnings, []);

    // VLM failure: exactly the one pre-existing fallback warning.
    const withoutVision = await storeTemporaryAsset(
      await fixtureFile("identical-basic.png"),
      undefined,
      {
        rootDirectory,
        localVision: null,
        visionProvider: {
          async analyze() {
            throw new Error("provider unavailable\nconnection reset by peer");
          },
        },
      },
    );
    assert.equal(withoutVision.analysisSource, "basic");
    assert.equal(withoutVision.analysis.contentType, "unknown");
    assert.equal(withoutVision.analysisWarnings.length, 1);
    assert.match(
      withoutVision.analysisWarnings[0],
      /^Semantic vision analysis was unavailable; basic image analysis was used\./,
    );
    assert.match(
      withoutVision.analysisWarnings[0],
      /Reason: provider unavailable connection reset by peer/,
    );
  });
});

test("local layer failures degrade to pixel analysis per field with warnings", async () => {
  await withStore(async (rootDirectory) => {
    const degraded = await storeTemporaryAsset(
      await fixtureFile("local-failure.png"),
      undefined,
      {
        rootDirectory,
        localVision: fakeLocalVision({
          faceError: new Error(
            'Local vision model file is missing: /models/yunet_2023mar.onnx. Run "node scripts/fetch-vision-models.mjs" to download it',
          ),
          contourError: new Error("onnx inference failed\nbad tensor shape"),
        }),
        visionProvider: semanticVisionProvider(),
      },
    );

    assert.equal(degraded.analysisSource, "vision");
    // VLM semantics still land; geometry is exactly the pixel-analysis set
    // (i.e. absent), never blocking the upload. The local mask centroid is
    // gone, so the VLM saliencyCenter fills the gap.
    assert.equal(degraded.analysis.contentType, "pet");
    assert.equal(degraded.analysis.faces, undefined);
    assert.equal(degraded.analysis.subjectBox, undefined);
    assert.deepEqual(degraded.analysis.saliencyCenter, { x: 0.9, y: 0.1 });
    assert.equal(degraded.analysis.subjectContour, undefined);

    assert.equal(degraded.analysisWarnings.length, 2);
    assert.match(
      degraded.analysisWarnings[0],
      /^Local face detection failed after \d+ms; no face boxes were recorded\. Reason: .*yunet_2023mar\.onnx/,
    );
    assert.match(
      degraded.analysisWarnings[1],
      /^Local subject segmentation failed after \d+ms; pixel-only geometry was kept\. Reason: onnx inference failed bad tensor shape/,
    );

    // The same field set as a fully disabled local layer: a failed local
    // layer adds observability, not behavior drift (assetId differs per
    // asset by design, everything else must match).
    const disabled = await storeTemporaryAsset(
      await fixtureFile("local-off.png"),
      undefined,
      {
        rootDirectory,
        localVision: null,
        visionProvider: semanticVisionProvider(),
      },
    );
    const { assetId: _degradedId, ...degradedFields } = degraded.analysis;
    const { assetId: _disabledId, ...disabledFields } = disabled.analysis;
    assert.deepEqual(degradedFields, disabledFields);
  });
});

test("rejects MIME spoofing and enforces a six image session limit", async () => {
  await withStore(async (rootDirectory) => {
    const spoofed = await fixtureFile("spoofed.jpg", "image/jpeg");
    await assert.rejects(
      () =>
        storeTemporaryAsset(
          spoofed,
          undefined,
          { rootDirectory, localVision: null },
        ),
      (error) =>
        error instanceof TemporaryAssetError &&
        error.code === "invalid_file",
    );

    const sessionId = crypto.randomUUID();
    for (let index = 0; index < 6; index += 1) {
      await storeTemporaryAsset(
        await fixtureFile(`sample-${index}.png`),
        sessionId,
        { rootDirectory, localVision: null },
      );
    }
    const seventh = await fixtureFile("sample-7.png");
    await assert.rejects(
      () =>
        storeTemporaryAsset(
          seventh,
          sessionId,
          { rootDirectory, localVision: null },
        ),
      (error) =>
        error instanceof TemporaryAssetError && error.code === "asset_limit",
    );
  });
});

test("expires, cleans up, and explicitly deletes temporary assets", async () => {
  await withStore(async (rootDirectory) => {
    const createdAt = new Date("2026-07-06T00:00:00.000Z");
    const first = await storeTemporaryAsset(
      await fixtureFile("first.png"),
      undefined,
      { rootDirectory, now: createdAt, ttlMs: 1_000, localVision: null },
    );
    await assert.rejects(
      () =>
        getTemporaryAsset(first.id, first.sessionId, {
          rootDirectory,
          now: new Date("2026-07-06T00:00:02.000Z"),
        }),
      (error) =>
        error instanceof TemporaryAssetError && error.code === "expired",
    );
    const removed = await cleanupExpiredAssets({
      rootDirectory,
      now: new Date("2026-07-06T00:00:02.000Z"),
    });
    assert.equal(removed, 1);
    assert.equal((await readdir(rootDirectory)).length, 0);

    const second = await storeTemporaryAsset(
      await fixtureFile("second.png"),
      undefined,
      { rootDirectory, localVision: null },
    );
    await deleteTemporaryAsset(second.id, second.sessionId, {
      rootDirectory,
    });
    assert.equal((await readdir(rootDirectory)).length, 0);
  });
});

test("reads the original buffer with existence, expiry, and size guards", async () => {
  await withStore(async (rootDirectory) => {
    const now = new Date("2026-07-06T00:00:00.000Z");
    const record = await storeTemporaryAsset(
      await fixtureFile("buffer.png"),
      undefined,
      { rootDirectory, now, localVision: null },
    );

    const content = await readTemporaryAssetOriginalBuffer(
      record.id,
      record.sessionId,
      { rootDirectory, now },
    );
    assert.equal(content.assetId, record.id);
    assert.equal(content.mimeType, "image/png");
    assert.ok(
      content.buffer.equals(
        await readFile(path.join(rootDirectory, `${record.id}.original`)),
      ),
    );

    await assert.rejects(
      () =>
        readTemporaryAssetOriginalBuffer(record.id, crypto.randomUUID(), {
          rootDirectory,
          now,
        }),
      (error) =>
        error instanceof TemporaryAssetError && error.code === "forbidden",
    );
    await assert.rejects(
      () =>
        readTemporaryAssetOriginalBuffer(record.id, record.sessionId, {
          rootDirectory,
          now: new Date("2026-07-07T00:00:01.000Z"),
        }),
      (error) =>
        error instanceof TemporaryAssetError && error.code === "expired",
    );

    await rm(path.join(rootDirectory, `${record.id}.original`));
    await assert.rejects(
      () =>
        readTemporaryAssetOriginalBuffer(record.id, record.sessionId, {
          rootDirectory,
          now,
        }),
      (error) =>
        error instanceof TemporaryAssetError && error.code === "not_found",
    );

    const oversized = await storeTemporaryAsset(
      await fixtureFile("oversized.png"),
      undefined,
      { rootDirectory, now, localVision: null },
    );
    await writeFile(
      path.join(rootDirectory, `${oversized.id}.original`),
      Buffer.alloc(20 * 1024 * 1024 + 1),
    );
    await assert.rejects(
      () =>
        readTemporaryAssetOriginalBuffer(oversized.id, oversized.sessionId, {
          rootDirectory,
          now,
        }),
      (error) =>
        error instanceof TemporaryAssetError && error.code === "invalid_file",
    );
  });
});
