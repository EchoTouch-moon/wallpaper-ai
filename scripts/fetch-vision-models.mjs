#!/usr/bin/env node
/**
 * scripts/fetch-vision-models.mjs
 *
 * Downloads the ONNX models used by lib/server/localVision.ts into models/:
 *
 *   yunet_2023mar.onnx      face detection
 *     source: opencv/opencv_zoo models/face_detection_yunet (2023mar release)
 *     verified in temp/spike/face-spike.mjs (remote ETag equals the sha256
 *     below, i.e. the upstream blob is byte-identical to the spike-tested file)
 *
 *   isnet-general-use.onnx  subject contour segmentation
 *     source: danielgatis/rembg GitHub release v0.0.0 asset
 *     verified in temp/spike/contour-spike.mjs
 *
 * Integrity: every file is checked against the pinned byte size and sha256
 * (taken from the spike-validated local copies). An existing file that passes
 * verification is skipped; a file that fails verification is re-downloaded.
 * Pass --force to re-download even valid files.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODELS_DIR = path.join(ROOT, "models");
const FORCE = process.argv.includes("--force");

const MODELS = [
  {
    file: "yunet_2023mar.onnx",
    url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    source: "opencv/opencv_zoo models/face_detection_yunet (2023mar)",
    bytes: 232589,
    sha256:
      "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
  },
  {
    file: "isnet-general-use.onnx",
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
    source: "danielgatis/rembg release v0.0.0 asset",
    bytes: 178648008,
    sha256:
      "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
  },
];

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function verifyFile(filePath, model) {
  const info = await stat(filePath);
  if (info.size !== model.bytes) {
    return `size mismatch: expected ${model.bytes} bytes, found ${info.size}`;
  }
  const digest = await sha256File(filePath);
  if (digest !== model.sha256) {
    return `sha256 mismatch: expected ${model.sha256}, found ${digest}`;
  }
  return null;
}

async function downloadModel(model) {
  const target = path.join(MODELS_DIR, model.file);
  const partPath = `${target}.part`;
  const response = await fetch(model.url, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error(
      `Download failed for ${model.file}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(partPath),
  );
  const problem = await verifyFile(partPath, model);
  if (problem !== null) {
    await rm(partPath, { force: true });
    throw new Error(
      `Downloaded ${model.file} failed verification (${problem}); the upstream file may have changed. Refusing to install.`,
    );
  }
  await rename(partPath, target);
}

async function main() {
  await mkdir(MODELS_DIR, { recursive: true });
  let failures = 0;
  for (const model of MODELS) {
    const target = path.join(MODELS_DIR, model.file);
    const label = `${model.file} (${(model.bytes / 1024 / 1024).toFixed(1)} MB, ${model.source})`;
    let existingProblem = "missing";
    try {
      await stat(target);
      existingProblem = FORCE ? "forced" : await verifyFile(target, model);
    } catch {
      existingProblem = "missing";
    }
    if (existingProblem === null) {
      console.log(`[skip] ${label} — already present and verified`);
      continue;
    }
    if (existingProblem !== "missing" && existingProblem !== "forced") {
      console.warn(
        `[warn] ${model.file} exists but failed verification (${existingProblem}); re-downloading`,
      );
    }
    try {
      console.log(`[download] ${label}`);
      console.log(`  from ${model.url}`);
      await downloadModel(model);
      console.log(`[ok] ${model.file} verified (size + sha256)`);
    } catch (error) {
      failures += 1;
      console.error(`[error] ${(error && error.message) || String(error)}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
    console.error(`${failures} model(s) failed to fetch`);
    return;
  }
  console.log("All local vision models are ready in models/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
