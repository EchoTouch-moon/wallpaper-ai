import { ZodError } from "zod";
import {
  generateLayouts,
  generateLayoutsAsync,
} from "./generateLayouts.ts";
import { LayoutGenerationError } from "./generationFallback.ts";
import { generateLayoutRequestSchema } from "./schema.ts";
import type { GenerateLayoutResponse } from "../types/generateLayout";
import type { LayoutModelProvider } from "./provider.ts";

export interface GenerateLayoutIssue {
  path: string;
  message: string;
}

export interface GenerateLayoutErrorResponse {
  error: string;
  code?: "invalid_json" | "invalid_request" | "generation_failed";
  issues?: GenerateLayoutIssue[];
}

export interface GenerateLayoutHandlerResponse {
  status: number;
  body: GenerateLayoutResponse | GenerateLayoutErrorResponse;
}

const UNSUPPORTED_PAYLOAD_FIELDS: Record<string, string> = {
  base64: "Raw image data must not be sent to the layout API.",
  dataUrl: "Image data URLs must not be sent to the layout API.",
  fabric: "Fabric objects belong to the frontend rendering layer.",
  fabricObject: "Fabric objects belong to the frontend rendering layer.",
  file: "Image files must not be sent to the layout API.",
  objectUrl: "Browser object URLs must not be sent to the layout API.",
  previewUrl: "Preview URLs belong to the frontend rendering layer.",
  thumbnailUrl: "Thumbnail URLs belong to the frontend rendering layer.",
};

function formatPath(path: Array<string | number>) {
  return path.length > 0 ? path.join(".") : "body";
}

export function findUnsupportedPayloadFields(
  value: unknown,
  path: Array<string | number> = [],
): GenerateLayoutIssue[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findUnsupportedPayloadFields(item, [...path, index]),
    );
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nestedValue]) => {
      const nestedPath = [...path, key];
      const issue: GenerateLayoutIssue[] = UNSUPPORTED_PAYLOAD_FIELDS[key]
        ? [
            {
              path: formatPath(nestedPath),
              message: UNSUPPORTED_PAYLOAD_FIELDS[key],
            },
          ]
        : [];

      return [
        ...issue,
        ...findUnsupportedPayloadFields(nestedValue, nestedPath),
      ];
    },
  );
}

export function createInvalidJsonResponse(): GenerateLayoutHandlerResponse {
  return {
    status: 400,
    body: {
      error: "Invalid JSON body",
      code: "invalid_json",
      issues: [
        {
          path: "body",
          message: "Request body must be valid JSON.",
        },
      ],
    },
  };
}

export function handleGenerateLayoutRequest(
  body: unknown,
): GenerateLayoutHandlerResponse {
  try {
    const unsupportedIssues = findUnsupportedPayloadFields(body);

    if (unsupportedIssues.length > 0) {
      return {
        status: 400,
        body: {
          error: "Invalid generate-layout request",
          code: "invalid_request",
          issues: unsupportedIssues,
        },
      };
    }

    const input = generateLayoutRequestSchema.parse(body);
    return {
      status: 200,
      body: generateLayouts(input),
    };
  } catch (error) {
    return handleGenerateLayoutError(error);
  }
}

export async function handleGenerateLayoutRequestAsync(
  body: unknown,
  dependencies: { provider?: LayoutModelProvider } = {},
): Promise<GenerateLayoutHandlerResponse> {
  try {
    const unsupportedIssues = findUnsupportedPayloadFields(body);

    if (unsupportedIssues.length > 0) {
      return {
        status: 400,
        body: {
          error: "Invalid generate-layout request",
          code: "invalid_request",
          issues: unsupportedIssues,
        },
      };
    }

    const input = generateLayoutRequestSchema.parse(body);
    return {
      status: 200,
      body: await generateLayoutsAsync(input, dependencies),
    };
  } catch (error) {
    return handleGenerateLayoutError(error);
  }
}

export function handleGenerateLayoutError(
  error: unknown,
): GenerateLayoutHandlerResponse {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: "Invalid generate-layout request",
        code: "invalid_request",
        issues: error.issues.map((issue) => ({
          path: formatPath(
            issue.path.filter(
              (part): part is string | number =>
                typeof part === "string" || typeof part === "number",
            ),
          ),
          message: issue.message,
        })),
      },
    };
  }

  if (error instanceof LayoutGenerationError) {
    return {
      status: 422,
      body: {
        error: error.message,
        code: "generation_failed",
      },
    };
  }

  return {
    status: 500,
    body: {
      error:
        error instanceof Error ? error.message : "Unable to generate layouts",
    },
  };
}
