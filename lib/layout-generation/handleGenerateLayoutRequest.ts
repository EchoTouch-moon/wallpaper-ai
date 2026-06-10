import { ZodError } from "zod";
import { generateLayouts } from "./generateLayouts.ts";
import { generateLayoutRequestSchema } from "./schema.ts";
import type { GenerateLayoutResponse } from "@/types/generateLayout";

export interface GenerateLayoutErrorResponse {
  error: string;
  issues?: Array<{
    path: string;
    message: string;
  }>;
}

export interface GenerateLayoutHandlerResponse {
  status: number;
  body: GenerateLayoutResponse | GenerateLayoutErrorResponse;
}

export function handleGenerateLayoutRequest(
  body: unknown,
): GenerateLayoutHandlerResponse {
  try {
    const input = generateLayoutRequestSchema.parse(body);
    return {
      status: 200,
      body: generateLayouts(input),
    };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        status: 400,
        body: {
          error: "Invalid generate-layout request",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
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
}
