import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultCompositionBrief } from "./compositionBrief.ts";
import { generateCompositionCandidates } from "./generateCompositionCandidates.ts";
import {
  assetContentReferenceSchema,
  buildGeneratePlanningRequest,
  buildRefinePlanningRequest,
  planningRequestV2Schema,
} from "./planningProtocol.ts";

function analysis(assetId, color) {
  return {
    assetId,
    width: 1920,
    height: 1080,
    orientation: "landscape",
    aspectRatio: 16 / 9,
    resolutionScore: 0.88,
    dominantColors: [color, color, color],
    averageColor: color,
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.4,
  };
}

const assets = [
  analysis("asset_a", "#456fd6"),
  analysis("asset_b", "#d65b80"),
  analysis("asset_c", "#46a47a"),
];

const brief = {
  ...createDefaultCompositionBrief({
    ratioId: "16:9",
    width: 1920,
    height: 1080,
    usage: "desktop",
  }),
  intent: {
    prompt: "Keep the second asset as hero and leave room for icons.",
    heroAssetId: "asset_b",
    hierarchy: "hero-support",
    density: "balanced",
    rhythm: "ordered",
    visualFlow: "left-to-right",
    moodTags: ["calm", "coastal"],
  },
};

function validGenerateRequest() {
  return {
    version: "2.0",
    operation: "generate",
    brief,
    assets,
  };
}

function previousLayout() {
  return generateCompositionCandidates({
    brief,
    assets,
    candidateCount: 3,
  }).candidates[0].layout;
}

function validRefineRequest() {
  return {
    version: "2.0",
    operation: "refine",
    brief,
    assets,
    refineInstruction: "Make the layout more layered and move the hero right.",
    previousCandidates: [previousLayout()],
  };
}

test("accepts a valid generate planning request", () => {
  const parsed = planningRequestV2Schema.parse(validGenerateRequest());

  assert.equal(parsed.version, "2.0");
  assert.equal(parsed.operation, "generate");
  assert.deepEqual(parsed.brief, brief);
  assert.equal(parsed.assets.length, 3);
  assert.equal(parsed.refineInstruction, undefined);
  assert.equal(parsed.previousCandidates, undefined);
  assert.equal(parsed.assetContent, undefined);
});

test("accepts a valid refine planning request", () => {
  const parsed = planningRequestV2Schema.parse(validRefineRequest());

  assert.equal(parsed.operation, "refine");
  assert.equal(
    parsed.refineInstruction,
    "Make the layout more layered and move the hero right.",
  );
  assert.equal(parsed.previousCandidates.length, 1);
  assert.equal(parsed.previousCandidates[0].version, "1.0");
});

test("accepts assetContent references for the multimodal stage", () => {
  const parsed = planningRequestV2Schema.parse({
    ...validGenerateRequest(),
    assetContent: [
      {
        assetId: "asset_a",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      },
      {
        assetId: "asset_c",
        dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
      },
    ],
  });

  assert.equal(parsed.assetContent.length, 2);
  assert.deepEqual(
    parsed.assetContent.map((content) => content.assetId),
    ["asset_a", "asset_c"],
  );
});

test("rejects unknown top-level keys and wrong protocol versions", () => {
  assert.throws(
    () => planningRequestV2Schema.parse({ ...validGenerateRequest(), extra: 1 }),
    /unrecognized/i,
  );
  assert.throws(
    () =>
      planningRequestV2Schema.parse({
        ...validGenerateRequest(),
        version: "1.0",
      }),
    /invalid/i,
  );
  assert.throws(
    () =>
      planningRequestV2Schema.parse({
        ...validGenerateRequest(),
        operation: "generate-layout",
      }),
    /invalid/i,
  );
});

test("rejects generate requests that carry refine-only fields", () => {
  const issues = (payload) =>
    planningRequestV2Schema.safeParse(payload).error.issues.map(
      (issue) => issue.path.join("."),
    );

  assert.ok(issues({ ...validGenerateRequest(), refineInstruction: "calmer" }).includes("refineInstruction"));
  assert.ok(
    issues({ ...validGenerateRequest(), previousCandidates: [previousLayout()] }).includes(
      "previousCandidates",
    ),
  );
});

test("requires refineInstruction and previousCandidates for refine operations", () => {
  const issues = (payload) =>
    planningRequestV2Schema.safeParse(payload).error.issues.map(
      (issue) => issue.path.join("."),
    );

  const missingInstruction = validRefineRequest();
  delete missingInstruction.refineInstruction;
  assert.ok(issues(missingInstruction).includes("refineInstruction"));

  const missingCandidates = validRefineRequest();
  delete missingCandidates.previousCandidates;
  assert.ok(issues(missingCandidates).includes("previousCandidates"));

  const tooManyCandidates = validRefineRequest();
  tooManyCandidates.previousCandidates = [
    previousLayout(),
    previousLayout(),
    previousLayout(),
    previousLayout(),
  ];
  assert.ok(
    issues(tooManyCandidates).some((path) => path.startsWith("previousCandidates")),
  );
});

test("rejects duplicate assets and unknown hero assets", () => {
  const duplicateAssets = validGenerateRequest();
  duplicateAssets.assets = [...assets, analysis("asset_a", "#111111")];

  assert.ok(
    planningRequestV2Schema
      .safeParse(duplicateAssets)
      .error.issues.some((issue) => issue.path.join(".").startsWith("assets")),
  );

  const unknownHero = validGenerateRequest();
  unknownHero.brief = {
    ...brief,
    intent: { ...brief.intent, heroAssetId: "asset_missing" },
  };

  assert.ok(
    planningRequestV2Schema
      .safeParse(unknownHero)
      .error.issues.some((issue) => issue.path.join(".") === "brief.intent.heroAssetId"),
  );
});

test("requires between two and six analyzed assets", () => {
  const singleAsset = validGenerateRequest();
  singleAsset.assets = [assets[0]];

  assert.ok(
    planningRequestV2Schema.safeParse(singleAsset).error.issues.length > 0,
  );
});

test("rejects previous candidates that reference unknown assets", () => {
  const request = validRefineRequest();
  request.previousCandidates = [
    {
      ...previousLayout(),
      items: previousLayout().items.map((item, index) =>
        index === 0 ? { ...item, assetId: "asset_missing" } : item,
      ),
    },
  ];

  assert.ok(
    planningRequestV2Schema
      .safeParse(request)
      .error.issues.some((issue) =>
        issue.path.join(".").startsWith("previousCandidates.0.items"),
      ),
  );
});

test("rejects asset content that is unknown, duplicated, or not a base64 data URL", () => {
  const issues = (payload) =>
    planningRequestV2Schema.safeParse(payload).error.issues.map(
      (issue) => issue.path.join("."),
    );

  assert.ok(
    issues({
      ...validGenerateRequest(),
      assetContent: [{ assetId: "asset_missing", dataUrl: "data:image/png;base64,AAAA" }],
    }).some((path) => path.startsWith("assetContent")),
  );

  assert.ok(
    issues({
      ...validGenerateRequest(),
      assetContent: [
        { assetId: "asset_a", dataUrl: "data:image/png;base64,AAAA" },
        { assetId: "asset_a", dataUrl: "data:image/png;base64,BBBB" },
      ],
    }).some((path) => path.startsWith("assetContent")),
  );

  assert.throws(
    () =>
      assetContentReferenceSchema.parse({
        assetId: "asset_a",
        dataUrl: "https://cdn.example.com/asset_a.png",
      }),
    /invalid/i,
  );
  assert.throws(
    () =>
      assetContentReferenceSchema.parse({
        assetId: "asset_a",
        dataUrl: "data:image/png;base64,not-base64!",
      }),
    /invalid/i,
  );
});

test("build factories produce valid requests and validate their input", () => {
  const generate = buildGeneratePlanningRequest(brief, assets);
  assert.equal(generate.version, "2.0");
  assert.equal(generate.operation, "generate");
  assert.equal(generate.brief.intent.heroAssetId, "asset_b");

  const refine = buildRefinePlanningRequest(
    brief,
    assets,
    "Make the hero larger.",
    [previousLayout()],
  );
  assert.equal(refine.operation, "refine");
  assert.equal(refine.refineInstruction, "Make the hero larger.");

  assert.throws(
    () => buildRefinePlanningRequest(brief, [assets[0]], "x", []),
    (error) =>
      Array.isArray(error.issues) &&
      error.issues.some((issue) =>
        issue.path.includes("previousCandidates"),
      ),
  );
});
