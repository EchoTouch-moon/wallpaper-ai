import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { createDefaultCompositionBrief } from "../../../packages/core/src/layout-generation/compositionBrief.ts";
import { POST as uploadAsset } from "../assets/route.ts";
import { GET as readAssetContent } from "../assets/[assetId]/content/route.ts";
import { POST as createComposition } from "./route.ts";
import {
  DELETE as deleteComposition,
  GET as getComposition,
} from "./[compositionId]/route.ts";
import { POST as refineComposition } from "./[compositionId]/refine/route.ts";
import { POST as undoRefinement } from "./[compositionId]/undo/route.ts";

async function imageFile(name, color) {
  const buffer = await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
  return new File([buffer], name, { type: "image/png" });
}

async function upload(file, sessionId) {
  const body = new FormData();
  body.set("file", file);
  if (sessionId) {
    body.set("sessionId", sessionId);
  }
  const response = await uploadAsset(
    new Request("http://localhost/api/assets", {
      method: "POST",
      body,
    }),
  );
  assert.equal(response.status, 201);
  return response.json();
}

test("rejects malformed composition JSON", async () => {
  const response = await createComposition(
    new Request("http://localhost/api/compositions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "invalid_json");
});

test("uploads real images, creates a composition, refines it, and restores it", async () => {
  const assetRoot = await mkdtemp(path.join(tmpdir(), "one-touch-api-assets-"));
  const compositionRoot = await mkdtemp(
    path.join(tmpdir(), "one-touch-api-compositions-"),
  );
  const previousAssetRoot = process.env.ONE_TOUCH_STORAGE_DIR;
  const previousCompositionRoot = process.env.ONE_TOUCH_COMPOSITION_DIR;
  const previousVision = process.env.VISION_ENABLED;
  const previousLocalVision = process.env.LOCAL_VISION_ENABLED;
  process.env.ONE_TOUCH_STORAGE_DIR = assetRoot;
  process.env.ONE_TOUCH_COMPOSITION_DIR = compositionRoot;
  process.env.VISION_ENABLED = "false";
  // Keep the API test off the (default-on) local ONNX geometry layer so it
  // neither runs real model inference nor records local-layer warnings.
  process.env.LOCAL_VISION_ENABLED = "false";

  try {
    const first = await upload(
      await imageFile("first.png", {
        r: 60,
        g: 100,
        b: 210,
        alpha: 1,
      }),
    );
    const second = await upload(
      await imageFile("second.png", {
        r: 200,
        g: 90,
        b: 120,
        alpha: 1,
      }),
      first.sessionId,
    );
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(first.asset.analysisSource, "basic");

    const contentUrl = new URL(first.asset.thumbnailUrl, "http://localhost");
    const contentResponse = await readAssetContent(
      new Request(contentUrl),
      { params: Promise.resolve({ assetId: first.asset.id }) },
    );
    assert.equal(contentResponse.status, 200);
    assert.equal(contentResponse.headers.get("Content-Type"), "image/webp");

    const brief = createDefaultCompositionBrief({
      ratioId: "16:9",
      width: 1920,
      height: 1080,
      usage: "desktop",
    });
    const createResponse = await createComposition(
      new Request("http://localhost/api/compositions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: first.sessionId,
          brief: {
            ...brief,
            intent: {
              ...brief.intent,
              heroAssetId: second.asset.id,
              prompt: "Keep room for icons and make the second image the hero.",
            },
          },
          assetIds: [first.asset.id, second.asset.id],
        }),
      }),
    );
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.composition.candidates.length, 3);
    assert.equal(
      created.composition.candidates[0].layout.items.find(
        (item) => item.role === "hero",
      ).assetId,
      second.asset.id,
    );

    const compositionId = created.composition.id;
    const candidateId = created.composition.candidates[0].id;
    const refineResponse = await refineComposition(
      new Request(
        `http://localhost/api/compositions/${compositionId}/refine`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: first.sessionId,
            candidateId,
            instruction: "主图更大，整体更有层次，放在右侧",
            locked: {
              target: true,
              heroAsset: true,
              safeAreas: true,
            },
          }),
        },
      ),
      { params: Promise.resolve({ compositionId }) },
    );
    assert.equal(refineResponse.status, 200);
    const refined = await refineResponse.json();
    assert.equal(refined.composition.revisionCount, 1);
    assert.equal(
      refined.candidate.layout.template.recipe.family,
      "layered-collage",
    );

    const undoResponse = await undoRefinement(
      new Request(
        `http://localhost/api/compositions/${compositionId}/undo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: first.sessionId,
            candidateId: refined.candidate.id,
          }),
        },
      ),
      { params: Promise.resolve({ compositionId }) },
    );
    assert.equal(undoResponse.status, 200);
    const undone = await undoResponse.json();
    assert.equal(undone.composition.revisionCount, 0);
    assert.equal(undone.candidate.id, candidateId);

    const restoreResponse = await getComposition(
      new Request(`http://localhost/api/compositions/${compositionId}`, {
        headers: { "x-one-touch-session": first.sessionId },
      }),
      { params: Promise.resolve({ compositionId }) },
    );
    assert.equal(restoreResponse.status, 200);
    const restored = await restoreResponse.json();
    assert.equal(restored.composition.revisionCount, 0);

    const forbiddenResponse = await getComposition(
      new Request(`http://localhost/api/compositions/${compositionId}`, {
        headers: { "x-one-touch-session": crypto.randomUUID() },
      }),
      { params: Promise.resolve({ compositionId }) },
    );
    assert.equal(forbiddenResponse.status, 403);

    const deleteResponse = await deleteComposition(
      new Request(`http://localhost/api/compositions/${compositionId}`, {
        method: "DELETE",
        headers: { "x-one-touch-session": first.sessionId },
      }),
      { params: Promise.resolve({ compositionId }) },
    );
    assert.equal(deleteResponse.status, 204);
  } finally {
    if (previousAssetRoot === undefined) {
      delete process.env.ONE_TOUCH_STORAGE_DIR;
    } else {
      process.env.ONE_TOUCH_STORAGE_DIR = previousAssetRoot;
    }
    if (previousCompositionRoot === undefined) {
      delete process.env.ONE_TOUCH_COMPOSITION_DIR;
    } else {
      process.env.ONE_TOUCH_COMPOSITION_DIR = previousCompositionRoot;
    }
    if (previousVision === undefined) {
      delete process.env.VISION_ENABLED;
    } else {
      process.env.VISION_ENABLED = previousVision;
    }
    if (previousLocalVision === undefined) {
      delete process.env.LOCAL_VISION_ENABLED;
    } else {
      process.env.LOCAL_VISION_ENABLED = previousLocalVision;
    }
    await Promise.all([
      rm(assetRoot, { recursive: true, force: true }),
      rm(compositionRoot, { recursive: true, force: true }),
    ]);
  }
});
