import { WALLPAPER_TEMPLATES } from "../layout/templates.ts";
import { planningRatio } from "./compositionBrief.ts";
import type { LayoutModelRequest } from "./provider.ts";
import type { PlanningRequest } from "./planningProtocol.ts";

export const AI_LAYOUT_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "reason",
          "harmonyScore",
          "templateId",
          "recipe",
          "assignments",
          "backgroundColor",
        ],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          reason: { type: "string" },
          harmonyScore: { type: "number", minimum: 0, maximum: 1 },
          templateId: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          recipe: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: [
                  "version",
                  "profile",
                  "family",
                  "heroPosition",
                  "heroShare",
                  "supportCount",
                  "margin",
                  "gap",
                  "cornerRadius",
                  "rhythm",
                  "boundary",
                  "safeAreaPolicy",
                ],
                properties: {
                  version: { type: "string", const: "1.0" },
                  profile: {
                    type: "string",
                    enum: ["safe", "editorial", "dynamic"],
                  },
                  family: {
                    type: "string",
                    enum: [
                      "hero-grid",
                      "balanced-mosaic",
                      "triptych",
                      "stacked-story",
                      "layered-collage",
                      "diagonal-collage",
                    ],
                  },
                  heroPosition: {
                    type: "string",
                    enum: ["left", "right", "top", "center", "background"],
                  },
                  heroShare: {
                    type: "number",
                    minimum: 0.32,
                    maximum: 0.76,
                  },
                  supportCount: {
                    type: "integer",
                    minimum: 1,
                    maximum: 5,
                  },
                  margin: { type: "number", minimum: 0, maximum: 0.12 },
                  gap: { type: "number", minimum: 0, maximum: 0.06 },
                  cornerRadius: {
                    type: "number",
                    minimum: 0,
                    maximum: 0.08,
                  },
                  rhythm: {
                    type: "string",
                    enum: ["ordered", "asymmetric", "layered"],
                  },
                  boundary: {
                    type: "string",
                    enum: [
                      "edge-to-edge",
                      "clean-gap",
                      "hairline",
                      "soft-shadow",
                      "overlap",
                      "feather",
                      "paper-edge",
                    ],
                  },
                  safeAreaPolicy: {
                    type: "string",
                    enum: ["avoid", "soft-avoid"],
                  },
                  slotIntents: {
                    type: "object",
                    additionalProperties: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        cropIntent: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            focus: {
                              anyOf: [
                                {
                                  type: "string",
                                  enum: ["subject", "saliency", "center"],
                                },
                                {
                                  type: "object",
                                  additionalProperties: false,
                                  required: ["x", "y"],
                                  properties: {
                                    x: {
                                      type: "number",
                                      minimum: 0,
                                      maximum: 1,
                                    },
                                    y: {
                                      type: "number",
                                      minimum: 0,
                                      maximum: 1,
                                    },
                                  },
                                },
                              ],
                            },
                            zoom: {
                              type: "string",
                              enum: ["tight", "standard", "loose"],
                            },
                          },
                        },
                        visualWeight: {
                          type: "string",
                          enum: ["dominant", "balanced", "subtle"],
                        },
                      },
                    },
                  },
                  layering: {
                    type: "string",
                    enum: ["none", "slight", "strong"],
                  },
                },
              },
              { type: "null" },
            ],
          },
          assignments: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["slotId", "assetId", "crop"],
              properties: {
                slotId: { type: "string" },
                assetId: { type: "string" },
                crop: {
                  anyOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: [
                        "x",
                        "y",
                        "width",
                        "height",
                        "focalPoint",
                      ],
                      properties: {
                        x: { type: "number", minimum: 0, maximum: 1 },
                        y: { type: "number", minimum: 0, maximum: 1 },
                        width: {
                          type: "number",
                          exclusiveMinimum: 0,
                          maximum: 1,
                        },
                        height: {
                          type: "number",
                          exclusiveMinimum: 0,
                          maximum: 1,
                        },
                        focalPoint: {
                          anyOf: [
                            {
                              type: "object",
                              additionalProperties: false,
                              required: ["x", "y"],
                              properties: {
                                x: {
                                  type: "number",
                                  minimum: 0,
                                  maximum: 1,
                                },
                                y: {
                                  type: "number",
                                  minimum: 0,
                                  maximum: 1,
                                },
                              },
                            },
                            { type: "null" },
                          ],
                        },
                      },
                    },
                    { type: "null" },
                  ],
                },
              },
            },
          },
          backgroundColor: {
            anyOf: [
              { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
              { type: "null" },
            ],
          },
        },
      },
    },
  },
} as const;

const LAYOUT_PLAN_OUTPUT_RULES = [
  "You plan editable photo wallpaper layouts.",
  "Return JSON only. Never return markdown or UI instructions.",
  "Prefer a parameterized recipe. Use a registered template only when refining a registered layout.",
  "For a recipe candidate set templateId to null. For a registered candidate set recipe to null.",
  "Recipe supportCount must equal the number of assets minus one.",
  "When returning three candidates, return exactly one safe, one editorial, and one dynamic recipe profile.",
  "Use stable generated slot IDs: hero, support-1 onward; layered-collage also starts with background.",
  "Assign every template slot exactly once.",
  "Use only supplied asset IDs.",
  "Do not create canvas coordinates, Fabric objects, polygons, image URLs, or image data.",
  "Use null when no crop or background override is needed.",
] as const;

const RECIPE_PROFILE_GOALS = [
  {
    profile: "safe",
    goal: "ordered structure, generous safe areas, conservative cropping",
  },
  {
    profile: "editorial",
    goal: "asymmetric hierarchy, magazine rhythm, intentional whitespace",
  },
  {
    profile: "dynamic",
    goal: "layered depth, stronger scale contrast, controlled overlap",
  },
] as const;

function candidateCountRule(candidateCount: number) {
  return `Return exactly ${candidateCount} candidate${candidateCount === 1 ? "" : "s"}.`;
}

const BRIEF_PLANNING_RULES = [
  "Map the composition brief to recipe semantics directly: hierarchy decides how strongly the hero dominates, density decides margin, gap, and heroShare, rhythm decides the recipe rhythm field, and visualFlow decides heroPosition and the support arrangement.",
  "When the brief names a heroAssetId, that exact asset must occupy the hero slot; keep it there even when its analysis suggests a supporting role.",
  "Honor the brief target: desktop and laptop canvases keep salient content away from icon and dock safe areas, ultrawide canvases favor horizontal flows, mobile and lock-screen canvases favor top-to-bottom flows, and a lock-screen canvas keeps the clock and widget areas visually quiet.",
  "When the brief target usage is desktop and its safeAreas include desktop-dock, keep the dock strip clear: cap recipe heroShare at 0.6 or raise recipe margin to at least 0.05, because a hero above that share or below that margin swallows the dock zone.",
  "Respect the brief constraints: preserveFaces and preserveText protect detected faces and text-heavy content from being cropped away, cropTolerance bounds how tightly an asset may be cropped, and safeAreas must stay free of salient content.",
  "Treat the brief prompt as the primary creative intent; the structural hierarchy, density, rhythm, and visualFlow fields qualify it, never override it.",
] as const;

const ASSET_ANALYSIS_RULES = [
  "Use the per-asset vision patches when assigning slots: faces, subjectBox, and saliencyCenter locate the content that must survive cropping, contentType and styleTags reveal subject matter and mood, bestUse suggests the natural role for each asset, and cropSafety bounds how aggressively each asset may be cropped.",
  "Prefer assets with high resolution, high contrast, and hero-appropriate content in the hero slot, and arrange adjacent assets so their dominant colors stay harmonious.",
] as const;

// Semantic control knobs (multimodal planning protocol v2 §2.2). They stay
// optional: an omitted field always compiles to the deterministic default.
const SLOT_INTENT_PLANNING_RULES = [
  "slotIntents and layering are optional semantic knobs; omit both whenever uncertain so the deterministic compiler defaults apply.",
  "Use slotIntents only to describe per-slot crop intent and visual weight: cropIntent.focus accepts subject, saliency, center, or a normalized 0-1 point, cropIntent.zoom accepts tight, standard, or loose, and visualWeight accepts dominant, balanced, or subtle.",
  "Use cropIntent focus subject or saliency only when that asset's analysis provides subjectBox or saliencyCenter; otherwise prefer center or omit the field.",
  "Keys of slotIntents must be slot IDs used in the same candidate's assignments; intents for slots the recipe does not produce are ignored.",
  "Use layering only when the profile or boundary actually stacks content: none keeps tiles separate, slight adds subtle depth overlap, and strong adds pronounced stacking.",
  "Emit slotIntents with no user prompt too: an automatic set still benefits from per-slot judgment, for example {\"hero\":{\"cropIntent\":{\"focus\":\"subject\"},\"visualWeight\":\"dominant\"}}, {\"support-1\":{\"visualWeight\":\"subtle\"}} differentiates slots the recipe alone would treat alike.",
  "Emit slotIntents for prompts in English or any other language whenever the prompt implies per-slot treatment: a prompt like \"keep every face fully visible, zoom the landscape supports\" maps to cropIntent {\"focus\":\"subject\",\"zoom\":\"loose\"} on the asset carrying a face and visualWeight \"subtle\" on the supports.",
] as const;

const REFINE_PLANNING_RULES = [
  "For refine operations, treat previousCandidates as the layouts to improve: keep what already works, apply the refineInstruction as a localized change, and keep the brief constraints unchanged.",
] as const;

// Style anchoring (style-library pinned briefs): the anchor names a
// reverse-engineered reference style. These rules only join the system
// message when the request actually carries a styleAnchor, so unstyled
// prompts stay byte-identical to the pre-anchor behavior.
const STYLE_ANCHOR_PLANNING_RULES = [
  "A styleAnchor pins the composition to a reverse-engineered reference style: every candidate MUST use the anchor family exactly; never substitute another family.",
  "Follow the anchor slot structure: keep its heroPosition, heroShare, supportCount, rhythm, boundary, layering, and slotIntents outline, adjusting only the minimum that hard constraints (safe areas, heroAssetId, asset count) force.",
  "A diagonal-collage anchor carries two hero slots: use slot IDs hero and hero-2 plus support-1 onward, and set recipe supportCount to the number of assets minus two.",
  "Obey the styleNotes constraints and taboos verbatim: they record what the reference style must keep and what it must never do; where a styleNote conflicts with a brief hard constraint, the brief constraint wins.",
] as const;

export function createLayoutPlanMessages(input: LayoutModelRequest) {
  const { request, operation } = input;
  const registeredTemplates = WALLPAPER_TEMPLATES.filter((template) =>
    template.supportedRatios.includes(request.canvas.ratioId),
  );
  const candidateCount =
    operation === "refine"
      ? 1
      : (request.options?.candidateCount ?? request.intent.count ?? 3);

  return {
    system: [
      ...LAYOUT_PLAN_OUTPUT_RULES,
      candidateCountRule(candidateCount),
    ].join(" "),
    user: JSON.stringify({
      operation,
      userPrompt: request.intent.userPrompt ?? null,
      canvas: request.canvas,
      style: request.intent.style,
      compositionIntent: request.intent.compositionIntent ?? null,
      assets: request.assets,
      recipeProfiles: RECIPE_PROFILE_GOALS,
      registeredTemplates,
      currentLayout:
        operation === "refine" ? (request.currentLayout ?? null) : null,
      outputSchema: AI_LAYOUT_PLAN_JSON_SCHEMA,
    }),
  };
}

export function createPlanningRequestMessages(planning: PlanningRequest) {
  const { brief, assets, operation } = planning;
  const registeredTemplates = WALLPAPER_TEMPLATES.filter((template) =>
    template.supportedRatios.includes(planningRatio(brief)),
  );
  const candidateCount = operation === "refine" ? 1 : 3;

  return {
    system: [
      ...LAYOUT_PLAN_OUTPUT_RULES,
      candidateCountRule(candidateCount),
      ...BRIEF_PLANNING_RULES,
      ...ASSET_ANALYSIS_RULES,
      ...SLOT_INTENT_PLANNING_RULES,
      ...(planning.styleAnchor ? STYLE_ANCHOR_PLANNING_RULES : []),
      ...(operation === "refine" ? REFINE_PLANNING_RULES : []),
    ].join(" "),
    user: JSON.stringify({
      version: planning.version,
      operation,
      userPrompt: brief.intent.prompt || null,
      heroAssetId: brief.intent.heroAssetId ?? null,
      brief,
      assets,
      ...(planning.styleAnchor ? { styleAnchor: planning.styleAnchor } : {}),
      refineInstruction:
        operation === "refine" ? (planning.refineInstruction ?? null) : null,
      previousCandidates:
        operation === "refine" ? (planning.previousCandidates ?? null) : null,
      recipeProfiles: RECIPE_PROFILE_GOALS,
      registeredTemplates,
      outputSchema: AI_LAYOUT_PLAN_JSON_SCHEMA,
    }),
  };
}

/**
 * OpenAI-compatible multimodal content parts (plan/multimodal-planning-
 * protocol-design.md §2.1): one annotated image_url part per assetContent
 * entry, followed by the authoritative text planning payload. Data URLs stay
 * in memory only — they are assembled here per call and never persisted or
 * logged.
 */
export type PlanningContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail: "auto" };
    };

export function createPlanningRequestContentParts(
  planning: PlanningRequest,
): PlanningContentPart[] {
  const assetContent = planning.assetContent ?? [];
  if (assetContent.length === 0) {
    throw new Error(
      "Multimodal planning content requires at least one assetContent reference",
    );
  }
  const parts: PlanningContentPart[] = [];
  assetContent.forEach((content, index) => {
    parts.push({
      type: "text",
      text: `Asset ${index + 1} of ${assetContent.length}; assetId: ${content.assetId}`,
    });
    parts.push({
      type: "image_url",
      image_url: { url: content.dataUrl, detail: "auto" },
    });
  });
  parts.push({
    type: "text",
    text: createPlanningRequestMessages(planning).user,
  });
  return parts;
}

/**
 * System addendum appended only when the request actually travels as
 * multimodal content, so the model knows how to read the image parts.
 */
export const VISION_PLANNING_SYSTEM_ADDENDUM =
  "When the user message carries image parts, each image is preceded by a text label with its assetId, and the final text part is the authoritative JSON planning payload; ground cropIntent and slot choices in those images.";
