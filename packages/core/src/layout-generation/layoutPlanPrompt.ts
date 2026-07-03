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
          "assignments",
          "backgroundColor",
        ],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          reason: { type: "string" },
          harmonyScore: { type: "number", minimum: 0, maximum: 1 },
          templateId: { type: "string" },
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
  const templates = WALLPAPER_TEMPLATES.filter((template) =>
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
      "Choose only from the supplied template IDs and slot IDs.",
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
      templates,
      currentLayout:
        operation === "refine" ? (request.currentLayout ?? null) : null,
      outputSchema: AI_LAYOUT_PLAN_JSON_SCHEMA,
    }),
  };
}
