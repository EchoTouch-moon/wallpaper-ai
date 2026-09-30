import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { createDefaultCompositionBrief } from "../../packages/core/src/layout-generation/compositionBrief.ts";
import {
  cleanupExpiredCompositions,
  CompositionSessionError,
  createCompositionSession,
  deleteCompositionSession,
  getCompositionSession,
  refineCompositionSession,
  undoCompositionRefinement,
} from "./compositionSessionStore.ts";
import { storeTemporaryAsset } from "./temporaryAssetStore.ts";

async function fixtureFile(name, color) {
  const content = await sharp({
    create: {
      width: 160,
      height: 100,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
  return new File([content], name, { type: "image/png" });
}

async function withStores(run) {
  const assetRoot = await mkdtemp(
    path.join(tmpdir(), "one-touch-composition-assets-"),
  );
  const compositionRoot = await mkdtemp(
    path.join(tmpdir(), "one-touch-composition-test-"),
  );
  try {
    await run({ assetRoot, compositionRoot });
  } finally {
    await Promise.all([
      rm(assetRoot, { recursive: true, force: true }),
      rm(compositionRoot, { recursive: true, force: true }),
    ]);
  }
}

async function setup(options) {
  const sessionId = crypto.randomUUID();
  const now = new Date("2026-07-06T00:00:00.000Z");
  const colors = [
    { r: 70, g: 110, b: 214, alpha: 1 },
    { r: 190, g: 80, b: 130, alpha: 1 },
    { r: 70, g: 170, b: 130, alpha: 1 },
  ];
  const assets = [];
  for (let index = 0; index < colors.length; index += 1) {
    assets.push(
      await storeTemporaryAsset(
        await fixtureFile(`asset-${index}.png`, colors[index]),
        sessionId,
        { rootDirectory: options.assetRoot, now },
      ),
    );
  }
  const brief = createDefaultCompositionBrief({
    ratioId: "16:9",
    width: 1920,
    height: 1080,
    usage: "desktop",
  });
  return { assets, brief, now, sessionId };
}

test("creates and protects a recoverable three-candidate session", async () => {
  await withStores(async (roots) => {
    const { assets, brief, now, sessionId } = await setup(roots);
    const record = await createCompositionSession(
      sessionId,
      brief,
      assets,
      { rootDirectory: roots.compositionRoot, now },
    );

    assert.equal(record.status, "ready");
    assert.equal(record.candidates.length, 3);
    assert.deepEqual(
      record.candidates.map(
        (candidate) => candidate.layout.template.recipe.profile,
      ),
      ["safe", "editorial", "dynamic"],
    );
    const recovered = await getCompositionSession(record.id, sessionId, {
      rootDirectory: roots.compositionRoot,
      now,
    });
    assert.equal(recovered.id, record.id);
    assert.deepEqual(
      recovered.candidates.map((candidate) => candidate.id),
      record.candidates.map((candidate) => candidate.id),
    );
    await assert.rejects(
      () =>
        getCompositionSession(record.id, crypto.randomUUID(), {
          rootDirectory: roots.compositionRoot,
          now,
        }),
      (error) =>
        error instanceof CompositionSessionError &&
        error.code === "forbidden",
    );
  });
});

test("refines one candidate and preserves the other two", async () => {
  await withStores(async (roots) => {
    const { assets, brief, now, sessionId } = await setup(roots);
    const record = await createCompositionSession(
      sessionId,
      brief,
      assets,
      { rootDirectory: roots.compositionRoot, now },
    );
    const selected = record.candidates[0];
    const result = await refineCompositionSession(
      record.id,
      sessionId,
      selected.id,
      "主图更大，右侧构图，更有层次",
      { target: true, heroAsset: true, safeAreas: true },
      assets,
      {
        rootDirectory: roots.compositionRoot,
        now: new Date("2026-07-06T00:01:00.000Z"),
      },
    );

    assert.equal(result.record.revisions.length, 1);
    assert.equal(
      result.candidate.layout.template.recipe.family,
      "layered-collage",
    );
    assert.equal(
      result.candidate.layout.template.recipe.heroPosition,
      "right",
    );
    assert.deepEqual(
      result.record.candidates.slice(1).map((candidate) => candidate.id),
      record.candidates.slice(1).map((candidate) => candidate.id),
    );

    const undone = await undoCompositionRefinement(
      record.id,
      sessionId,
      result.candidate.id,
      {
        rootDirectory: roots.compositionRoot,
        now: new Date("2026-07-06T00:02:00.000Z"),
      },
    );
    assert.equal(undone.candidate.id, selected.id);
    assert.equal(undone.record.revisions.length, 0);
    assert.equal(
      undone.record.candidates[0].layout.template.recipe.family,
      selected.layout.template.recipe.family,
    );
  });
});

test("expires, cleans up, and explicitly deletes composition sessions", async () => {
  await withStores(async (roots) => {
    const { assets, brief, now, sessionId } = await setup(roots);
    const first = await createCompositionSession(
      sessionId,
      brief,
      assets,
      {
        rootDirectory: roots.compositionRoot,
        now,
        ttlMs: 1_000,
      },
    );
    await assert.rejects(
      () =>
        getCompositionSession(first.id, sessionId, {
          rootDirectory: roots.compositionRoot,
          now: new Date("2026-07-06T00:00:02.000Z"),
        }),
      (error) =>
        error instanceof CompositionSessionError &&
        error.code === "expired",
    );
    assert.equal(
      await cleanupExpiredCompositions({
        rootDirectory: roots.compositionRoot,
        now: new Date("2026-07-06T00:00:02.000Z"),
      }),
      1,
    );
    assert.equal((await readdir(roots.compositionRoot)).length, 0);

    const second = await createCompositionSession(
      sessionId,
      brief,
      assets,
      {
        rootDirectory: roots.compositionRoot,
        now,
      },
    );
    await deleteCompositionSession(second.id, sessionId, {
      rootDirectory: roots.compositionRoot,
      now,
    });
    assert.equal((await readdir(roots.compositionRoot)).length, 0);
  });
});
