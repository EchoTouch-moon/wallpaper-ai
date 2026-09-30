import { WALLPAPER_TEMPLATES } from "../layout/templates.ts";
import type { LayoutModelRequest } from "./provider.ts";

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
      `Return exactly ${candidateCount} candidate${candidateCount === 1 ? "" : "s"}.`,
    ].join(" "),
    user: JSON.stringify({
      operation,
      userPrompt: request.intent.userPrompt ?? null,
      canvas: request.canvas,
      style: request.intent.style,
      compositionIntent: request.intent.compositionIntent ?? null,
      assets: request.assets,
      recipeProfiles: [
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
      ],
      registeredTemplates,
      currentLayout:
        operation === "refine" ? (request.currentLayout ?? null) : null,
      outputSchema: AI_LAYOUT_PLAN_JSON_SCHEMA,
    }),
  };
}
