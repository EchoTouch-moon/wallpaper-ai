import process from "node:process";

import { generateLayoutsAsync } from "../lib/layout-generation/generateLayouts.ts";

function analysis(assetId, averageColor, orientation = "landscape") {
  const dimensions =
    orientation === "portrait"
      ? { width: 1440, height: 2160 }
      : { width: 2560, height: 1440 };

  return {
    assetId,
    ...dimensions,
    orientation,
    aspectRatio: dimensions.width / dimensions.height,
    resolutionScore: 0.92,
    dominantColors: [averageColor, "#5278d8", "#3e64c0"],
    averageColor,
    brightness: 0.5,
    saturation: 0.55,
    contrast: 0.42,
  };
}

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
    const response = await generateLayoutsAsync({
      operation: "generate",
      canvas: { width: 1920, height: 1080, ratioId: "16:9" },
      intent: {
        mode: "ai",
        style: "same-tone-triptych",
        compositionIntent: "balanced-collage",
        safeArea: "desktop-left",
        count: 3,
        userPrompt:
          "Create three restrained same-tone wallpaper candidates with clear image hierarchy.",
      },
      assets: [
        analysis("smoke_asset_a", "#456fd6"),
        analysis("smoke_asset_b", "#5278d8", "portrait"),
        analysis("smoke_asset_c", "#3e64c0"),
      ],
      options: {
        candidateCount: 3,
        allowFallback: false,
        strictValidation: true,
      },
    });

    if (response.source !== "ai" || response.candidates.length === 0) {
      throw new Error("The real model did not return a valid AI layout candidate.");
    }

    console.log(
      `AI layout smoke test passed: ${response.candidates.length} candidate(s), model=${process.env.LLM_MODEL}.`,
    );
  }
}
