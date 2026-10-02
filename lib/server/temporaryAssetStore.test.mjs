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

test("stores, analyzes, thumbnails, and protects a temporary image", async () => {
  await withStore(async (rootDirectory) => {
    const now = new Date("2026-07-06T00:00:00.000Z");
    const record = await storeTemporaryAsset(
      await fixtureFile(),
      undefined,
      { rootDirectory, now },
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

test("merges semantic vision analysis and falls back without blocking upload", async () => {
  await withStore(async (rootDirectory) => {
    const visionProvider = {
      async analyze() {
        return {
          contentType: "portrait",
          faces: [{ x: 0.35, y: 0.12, width: 0.2, height: 0.24 }],
          subjectBox: { x: 0.2, y: 0.08, width: 0.6, height: 0.84 },
          saliencyCenter: { x: 0.5, y: 0.42 },
          styleTags: ["soft", "portrait"],
          bestUse: ["hero", "portrait-collage"],
          cropSafety: "low",
        };
      },
    };
    const enriched = await storeTemporaryAsset(
      await fixtureFile("vision.png"),
      undefined,
      { rootDirectory, visionProvider },
    );
    assert.equal(enriched.analysisSource, "vision");
    assert.equal(enriched.analysis.contentType, "portrait");
    assert.equal(enriched.analysis.faces.length, 1);
    assert.equal(enriched.analysis.subjectBox.width, 0.6);

    const fallback = await storeTemporaryAsset(
      await fixtureFile("fallback.png"),
      undefined,
      {
        rootDirectory,
        visionProvider: {
          async analyze() {
            throw new Error("provider unavailable\nconnection reset by peer");
          },
        },
      },
    );
    assert.equal(fallback.analysisSource, "basic");
    assert.equal(fallback.analysisWarnings.length, 1);
    assert.match(
      fallback.analysisWarnings[0],
      /^Semantic vision analysis was unavailable; basic image analysis was used\./,
    );
    assert.match(
      fallback.analysisWarnings[0],
      /Reason: provider unavailable connection reset by peer/,
    );
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
          { rootDirectory },
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
        { rootDirectory },
      );
    }
    const seventh = await fixtureFile("sample-7.png");
    await assert.rejects(
      () =>
        storeTemporaryAsset(
          seventh,
          sessionId,
          { rootDirectory },
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
      { rootDirectory, now: createdAt, ttlMs: 1_000 },
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
      { rootDirectory },
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
      { rootDirectory, now },
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
      { rootDirectory, now },
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
