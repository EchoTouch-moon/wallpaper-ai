// Opt-in smoke test for the v2 planning protocol against a real model.
//
// Exercises the full OneTouch chain with no mocks:
//   PlanningRequest v2 (brief-native prompt, optional multimodal assetContent)
//   → OpenAI-compatible provider → TemplateRecipe → deterministic compiler
//   → validateLayout → candidate diversity → degradation warnings.
//
// Usage:
//   LLM_SMOKE_TEST=1 pnpm test:ai:smoke                     # text-only planning
//   LLM_SMOKE_TEST=1 pnpm test:ai:smoke -- --multimodal     # + synthetic images
//
// Environment: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL (e.g. glm-5.3-flash on
// https://open.bigmodel.cn/api/paas/v4/). --multimodal turns on
// VISION_PLANNING_ENABLED internally and reuses the same credentials unless
// VISION_API_KEY / VISION_MODEL / VISION_BASE_URL are set.

import process from "node:process";
import { readFile } from "node:fs/promises";

import { generateCompositionCandidatesAsync } from "@wallpaper/core/layout-generation";
import sharp from "sharp";

const multimodal = process.argv.includes("--multimodal");
const fixturePath =
  process.argv.find((arg) => arg.startsWith("--fixture="))?.slice("--fixture=".length) ??
  "eval/briefs/01-desktop-16x9-single-hero.json";

if (process.env.LLM_SMOKE_TEST !== "1") {
  console.error(
    "Refusing to call a real model. Set LLM_SMOKE_TEST=1 to enable this smoke test.",
  );
  process.exitCode = 2;
} else {
  const requiredVariables = ["LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"];
  const missingVariables = requiredVariables.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missingVariables.length > 0) {
    console.error(
      `Missing required model configuration: ${missingVariables.join(", ")}`,
    );
    process.exitCode = 2;
  } else {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    let request = fixture;

    if (multimodal) {
      const hues = [28, 205, 340, 120, 55, 260];
      const assetContent = await Promise.all(
        fixture.assets.map(async (asset, index) => {
          const hue = hues[index % hues.length];
          const svg = Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">` +
              `<rect width="800" height="500" fill="hsl(${hue}, 55%, 52%)"/>` +
              `<circle cx="${180 + index * 90}" cy="250" r="120" fill="hsl(${(hue + 40) % 360}, 70%, 70%)" opacity="0.85"/>` +
              `<rect x="520" y="${120 + index * 30}" width="200" height="260" fill="hsl(${(hue + 200) % 360}, 60%, 40%)" opacity="0.9"/>` +
              `</svg>`,
          );
          const png = await sharp(svg).png().toBuffer();
          return {
            assetId: asset.assetId,
            dataUrl: `data:image/png;base64,${png.toString("base64")}`,
          };
        }),
      );
      request = { ...fixture, assetContent };
      console.log(
        `Multimodal mode: ${assetContent.length} synthetic image(s) attached as assetContent.`,
      );
    }

    const environment = {
      ...process.env,
      ...(multimodal ? { VISION_PLANNING_ENABLED: "true" } : {}),
    };

    const startedAt = Date.now();
    const response = await generateCompositionCandidatesAsync(request, {
      environment,
    });
    const elapsedMs = Date.now() - startedAt;

    console.log(`fixture          : ${fixturePath}`);
    console.log(`model            : ${process.env.LLM_MODEL}${multimodal ? " (vision-planning on)" : ""}`);
    console.log(`source           : ${response.source}`);
    console.log(`elapsed          : ${elapsedMs} ms`);
    console.log(`candidates       : ${response.candidates.length}`);
    for (const candidate of response.candidates) {
      console.log(
        `  - [${candidate.id}] ${candidate.label} (harmony ${candidate.harmonyScore.toFixed(2)}, fallback=${candidate.usedFallback})`,
      );
      console.log(`      ${candidate.reason}`);
    }
    if (response.warnings.length > 0) {
      console.log("warnings         :");
      for (const warning of response.warnings) {
        console.log(`  - ${warning}`);
      }
    }

    if (response.source !== "ai" || response.candidates.length === 0) {
      console.error(
        "The real model did not yield any usable AI candidate (degraded to recipe-fallback).",
      );
      process.exitCode = 1;
    } else {
      console.log(
        `v2 protocol smoke passed: ${response.candidates.length} AI candidate(s) compiled from model recipes.`,
      );
    }
  }
}
