import { layoutCandidateSchema } from "../layout/layoutSchema.ts";
import type { LayoutCandidate } from "@/types/layout";

export function parseLayoutResponse(value: unknown): LayoutCandidate[] {
  const rawCandidates =
    typeof value === "object" &&
    value !== null &&
    "candidates" in value &&
    Array.isArray((value as { candidates?: unknown }).candidates)
      ? (value as { candidates: unknown[] }).candidates
      : Array.isArray(value)
        ? value
        : [];

  return rawCandidates.map((candidate) => layoutCandidateSchema.parse(candidate));
}

export function parseLayoutResponseText(text: string): LayoutCandidate[] {
  const trimmed = text.trim();
  const jsonStart = Math.min(
    ...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0),
  );
  const jsonText = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;

  return parseLayoutResponse(JSON.parse(jsonText));
}
