import assert from "node:assert/strict";
import test from "node:test";

import {
  compositionBriefSchema,
  createDefaultCompositionBrief,
} from "./compositionBrief.ts";

test("creates useful defaults for a desktop target", () => {
  const brief = createDefaultCompositionBrief({
    ratioId: "16:9",
    width: 3840,
    height: 2160,
    usage: "desktop",
  });

  assert.deepEqual(brief.constraints.safeAreas, [
    "desktop-icons-left",
    "desktop-dock",
  ]);
  assert.equal(brief.intent.visualFlow, "left-to-right");
});

test("creates lock-screen defaults", () => {
  const brief = createDefaultCompositionBrief({
    ratioId: "9:19.5",
    width: 1290,
    height: 2795,
    usage: "lock-screen",
  });

  assert.deepEqual(brief.constraints.safeAreas, ["mobile-clock"]);
  assert.equal(brief.intent.visualFlow, "top-to-bottom");
});

test("rejects oversized custom targets", () => {
  assert.throws(() =>
    compositionBriefSchema.parse({
      version: "1.0",
      target: {
        ratioId: "custom",
        width: 7680,
        height: 7680,
        usage: "desktop",
      },
      intent: {
        prompt: "",
        hierarchy: "hero-support",
        density: "balanced",
        rhythm: "ordered",
        visualFlow: "left-to-right",
        moodTags: [],
      },
      constraints: {
        safeAreas: [],
        preserveFaces: true,
        preserveText: true,
        cropTolerance: "medium",
      },
    }),
  );
});
