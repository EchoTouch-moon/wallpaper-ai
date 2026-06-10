import { layoutCandidateSchema } from "../layout/layoutSchema.ts";
import type { LayoutCandidate } from "@/types/layout";

export class LayoutModelResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutModelResponseError";
  }
}

export function parseLayoutResponse(value: unknown): LayoutCandidate[] {
  const rawCandidates =
    typeof value === "object" &&
    value !== null &&
    "candidates" in value &&
    Array.isArray((value as { candidates?: unknown }).candidates)
      ? (value as { candidates: unknown[] }).candidates
      : Array.isArray(value)
        ? value
        : null;

  if (!rawCandidates) {
    throw new LayoutModelResponseError(
      "Layout model response must be an array or an object with candidates.",
    );
  }

  try {
    return rawCandidates.map((candidate) =>
      layoutCandidateSchema.parse(candidate),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to parse layout model candidates.";
    throw new LayoutModelResponseError(message);
  }
}

export function parseLayoutResponseText(text: string): LayoutCandidate[] {
  const trimmed = text.trim();
  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fencedJson ?? trimmed;
  const jsonText = extractFirstJsonValue(source);

  if (!jsonText) {
    throw new LayoutModelResponseError(
      "Layout model response did not contain JSON.",
    );
  }

  try {
    return parseLayoutResponse(JSON.parse(jsonText));
  } catch (error) {
    if (error instanceof LayoutModelResponseError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "Invalid layout model JSON.";
    throw new LayoutModelResponseError(message);
  }
}

function extractFirstJsonValue(text: string) {
  const starts = [
    text.indexOf("{"),
    text.indexOf("["),
  ].filter((index) => index >= 0);

  if (starts.length === 0) {
    return null;
  }

  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === open) {
      depth += 1;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return text.slice(start);
}
