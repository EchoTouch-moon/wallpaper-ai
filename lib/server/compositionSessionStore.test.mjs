import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
      // environment: {} pins the vision gate off so the legacy assertions stay
      // independent of the host machine's VISION_PLANNING_ENABLED.
      { rootDirectory: roots.compositionRoot, now, environment: {} },
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
        environment: {},
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
        environment: {},
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
        environment: {},
      },
    );
    await deleteCompositionSession(second.id, sessionId, {
      rootDirectory: roots.compositionRoot,
      now,
    });
    assert.equal((await readdir(roots.compositionRoot)).length, 0);
  });
});

const visionGateOnEnvironment = {
  VISION_PLANNING_ENABLED: "true",
  VISION_API_KEY: "test-key",
  VISION_MODEL: "vision-model",
};

function recordingProvider(calls) {
  return {
    async generatePlan(input) {
      calls.push(input);
      // Empty model plan: the deterministic recipes complete the candidate set
      // so the session is still created while the request stays observable.
      return { candidates: [] };
    },
  };
}

function visionSessionOptions(roots, now, environment, calls) {
  return {
    rootDirectory: roots.compositionRoot,
    assetStoreOptions: { rootDirectory: roots.assetRoot, now },
    compositionProvider: recordingProvider(calls),
    environment,
    now,
  };
}

test("passes assembled asset content to the injected provider when the vision gate is on", async () => {
  await withStores(async (roots) => {
    const { assets, brief, now, sessionId } = await setup(roots);
    const calls = [];
    const record = await createCompositionSession(
      sessionId,
      brief,
      assets,
      visionSessionOptions(roots, now, visionGateOnEnvironment, calls),
    );

    assert.equal(record.status, "ready");
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0].assetContent.map((content) => content.assetId),
      assets.map((asset) => asset.id),
    );
    for (const content of calls[0].assetContent) {
      assert.match(content.dataUrl, /^data:image\/png;base64,/);
      const original = await readFile(
        path.join(roots.assetRoot, `${content.assetId}.original`),
      );
      assert.ok(
        Buffer.from(
          content.dataUrl.slice(content.dataUrl.indexOf(",") + 1),
          "base64",
        ).equals(original),
        "the dataUrl payload must match the stored original bytes",
      );
    }
  });
});

test("falls back to text-only planning with a warning when any asset buffer is unreadable", async () => {
  await withStores(async (roots) => {
    const { assets, brief, now, sessionId } = await setup(roots);
    await rm(path.join(roots.assetRoot, `${assets[1].id}.original`));
    const calls = [];
    const record = await createCompositionSession(
      sessionId,
      brief,
      assets,
      visionSessionOptions(roots, now, visionGateOnEnvironment, calls),
    );

    assert.equal(record.status, "ready");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].assetContent, undefined);
    assert.match(
      record.warnings.join("\n"),
      /Vision planning asset content was unavailable; fell back to text-only planning/,
    );
  });
});

test("reads no asset files when the vision gate is off", async () => {
  await withStores(async (roots) => {
    const { assets, brief, now, sessionId } = await setup(roots);
    // Remove one original: a wrongly wired assembly attempt would fail with
    // ENOENT and surface the degradation warning, so asserting no warning is
    // the behavioral proof that no asset file was read at all.
    await rm(path.join(roots.assetRoot, `${assets[0].id}.original`));
    const calls = [];
    const record = await createCompositionSession(
      sessionId,
      brief,
      assets,
      visionSessionOptions(roots, now, {}, calls),
    );

    assert.equal(record.status, "ready");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].assetContent, undefined);
    assert.equal(
      record.warnings.some((warning) =>
        warning.includes("Vision planning asset content was unavailable"),
      ),
      false,
    );
  });
});

test("refine passes assembled asset content to the injected provider when the vision gate is on", async () => {
  await withStores(async (roots) => {
    const { assets, brief, now, sessionId } = await setup(roots);
    const record = await createCompositionSession(
      sessionId,
      brief,
      assets,
      visionSessionOptions(roots, now, visionGateOnEnvironment, []),
    );
    const refineCalls = [];
    const refined = await refineCompositionSession(
      record.id,
      sessionId,
      record.candidates[0].id,
      "主图更大，右侧构图",
      { target: true, heroAsset: true, safeAreas: true },
      assets,
      visionSessionOptions(
        roots,
        new Date("2026-07-06T00:01:00.000Z"),
        visionGateOnEnvironment,
        refineCalls,
      ),
    );

    assert.equal(refined.record.status, "ready");
    assert.equal(refineCalls.length, 1);
    assert.equal(refineCalls[0].operation, "refine");
    assert.deepEqual(
      refineCalls[0].assetContent.map((content) => content.assetId),
      assets.map((asset) => asset.id),
    );
  });
});

test("refine falls back to text-only planning with a warning when an asset buffer is unreadable", async () => {
  await withStores(async (roots) => {
    const { assets, brief, now, sessionId } = await setup(roots);
    const record = await createCompositionSession(
      sessionId,
      brief,
      assets,
      visionSessionOptions(roots, now, visionGateOnEnvironment, []),
    );
    await rm(path.join(roots.assetRoot, `${assets[2].id}.original`));
    const refineCalls = [];
    const refined = await refineCompositionSession(
      record.id,
      sessionId,
      record.candidates[0].id,
      "主图更大，右侧构图",
      { target: true, heroAsset: true, safeAreas: true },
      assets,
      visionSessionOptions(
        roots,
        new Date("2026-07-06T00:01:00.000Z"),
        visionGateOnEnvironment,
        refineCalls,
      ),
    );

    assert.equal(refined.record.status, "ready");
    assert.equal(refineCalls.length, 1);
    assert.equal(refineCalls[0].assetContent, undefined);
    assert.match(
      refined.record.warnings.join("\n"),
      /Vision planning asset content was unavailable; fell back to text-only planning/,
    );
  });
});
