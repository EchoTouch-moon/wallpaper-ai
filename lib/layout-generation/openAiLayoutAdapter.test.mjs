import assert from "node:assert/strict";
import test from "node:test";
import { generateMockLayouts } from "./generateMockLayouts.ts";
import {
  OpenAILayoutAdapter,
  runAiLayoutPipeline,
} from "./openAiLayoutAdapter.ts";

function analysis(assetId, averageColor) {
  return {
    assetId,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 1920 / 1080,
    resolutionScore: 0.88,
    dominantColors: [averageColor, averageColor, averageColor],
    averageColor,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const request = {
  canvas: { width: 1920, height: 1080, ratioId: "16:9" },
  intent: {
    mode: "ai",
    style: "auto",
    compositionIntent: "hero-with-support",
    count: 3,
  },
  assets: [
    analysis("asset_a", "#456fd6"),
    analysis("asset_b", "#5278d8"),
    analysis("asset_c", "#3e64c0"),
  ],
  options: { candidateCount: 3, allowFallback: true, strictValidation: true },
};

function validCandidate() {
  return generateMockLayouts({
    ...request,
    intent: { ...request.intent, mode: "mock-ai" },
  }).candidates[0];
}

test("AI layout pipeline accepts valid model JSON", () => {
  const candidate = validCandidate();
  const response = runAiLayoutPipeline({
    request,
    modelOutputText: JSON.stringify({ candidates: [candidate] }),
  });

  assert.equal(response.source, "ai");
  assert.equal(response.candidates.length, 1);
  assert.equal(response.rejected.length, 0);
});

test("AI layout pipeline repairs out-of-bounds geometry before validation", () => {
  const candidate = validCandidate();
  const brokenCandidate = {
    ...candidate,
    layout: {
      ...candidate.layout,
      items: candidate.layout.items.map((item, index) =>
        index === 0
          ? {
              ...item,
              x: request.canvas.width + 200,
              y: -100,
              width: request.canvas.width * 2,
              height: request.canvas.height * 2,
            }
          : item,
      ),
    },
  };
  const response = runAiLayoutPipeline({
    request,
    modelOutputText: JSON.stringify({ candidates: [brokenCandidate] }),
  });

  assert.equal(response.source, "ai");
  assert.equal(response.candidates.length, 1);
  assert.ok(response.warnings?.[0].includes("repair pass"));
  const repairedItem = response.candidates[0].layout.items[0];
  assert.equal(repairedItem.x, 0);
  assert.equal(repairedItem.y, 0);
  assert.equal(repairedItem.width, request.canvas.width);
  assert.equal(repairedItem.height, request.canvas.height);
});

test("AI layout pipeline falls back when model JSON cannot be parsed", () => {
  const response = runAiLayoutPipeline({
    request,
    modelOutputText: "not json",
  });

  assert.equal(response.source, "fallback");
  assert.ok(response.warnings?.[0].includes("could not be parsed"));
  assert.equal(response.candidates.length, 3);
});

test("AI layout pipeline throws when fallback is disabled", () => {
  assert.throws(() =>
    runAiLayoutPipeline({
      request: {
        ...request,
        options: { ...request.options, allowFallback: false },
      },
      modelOutputText: "not json",
    }),
  );
});

test("OpenAI layout adapter skeleton uses injected model client when enabled", async () => {
  const candidate = validCandidate();
  let capturedPrompt = "";
  const adapter = new OpenAILayoutAdapter({
    enabled: true,
    modelClient: {
      async generateText(prompt) {
        capturedPrompt = prompt;
        return `\`\`\`json\n${JSON.stringify({ candidates: [candidate] })}\n\`\`\``;
      },
    },
  });
  const response = await adapter.generateLayoutResponse(request);

  assert.match(capturedPrompt, /Return strict JSON/);
  assert.equal(response.source, "ai");
  assert.equal(response.candidates.length, 1);
});

test("OpenAI layout adapter skeleton extracts JSON from model prose", async () => {
  const candidate = validCandidate();
  const adapter = new OpenAILayoutAdapter({
    enabled: true,
    modelClient: {
      async generateText() {
        return `Here is the layout JSON:\n${JSON.stringify({ candidates: [candidate] })}\nDone.`;
      },
    },
  });
  const response = await adapter.generateLayoutResponse(request);

  assert.equal(response.source, "ai");
  assert.equal(response.candidates.length, 1);
});

test("OpenAI layout adapter skeleton falls back when the model client fails", async () => {
  const adapter = new OpenAILayoutAdapter({
    enabled: true,
    modelClient: {
      async generateText() {
        throw new Error("model unavailable");
      },
    },
  });
  const response = await adapter.generateLayoutResponse(request);

  assert.equal(response.source, "fallback");
  assert.ok(response.warnings?.[0].includes("model unavailable"));
});

test("OpenAI layout adapter skeleton falls back while disabled", async () => {
  const adapter = new OpenAILayoutAdapter();
  const response = await adapter.generateLayoutResponse(request);

  assert.equal(response.source, "fallback");
  assert.ok(response.warnings?.[0].includes("disabled"));
});
