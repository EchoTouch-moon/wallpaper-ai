import { validateCandidates } from "./validateCandidates.ts";
import type { GenerateLayoutRequest } from "@/types/generateLayout";
import type { LayoutCandidate, WallpaperItem } from "@/types/layout";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function repairItem(
  item: WallpaperItem,
  index: number,
  usedItemIds: Set<string>,
  canvas: GenerateLayoutRequest["canvas"],
) {
  const id = usedItemIds.has(item.id) ? `${item.id}_${index + 1}` : item.id;
  usedItemIds.add(id);

  const width = clamp(Math.round(item.width), 1, canvas.width);
  const height = clamp(Math.round(item.height), 1, canvas.height);
  const x = clamp(Math.round(item.x), 0, canvas.width - width);
  const y = clamp(Math.round(item.y), 0, canvas.height - height);

  return {
    ...item,
    id,
    x,
    y,
    width,
    height,
    opacity: clamp(item.opacity, 0, 1),
  };
}

function repairCandidate(
  candidate: LayoutCandidate,
  request: GenerateLayoutRequest,
): LayoutCandidate {
  const usedItemIds = new Set<string>();
  const items = candidate.layout.items.map((item, index) =>
    repairItem(item, index, usedItemIds, request.canvas),
  );

  return {
    ...candidate,
    layout: {
      ...candidate.layout,
      canvas: {
        ...candidate.layout.canvas,
        width: request.canvas.width,
        height: request.canvas.height,
        ratio: request.canvas.ratioId,
      },
      items,
      notes: [
        ...candidate.layout.notes,
        "AI repair pass normalized canvas metadata and geometry bounds.",
      ],
    },
  };
}

export function repairLayoutCandidates(
  candidates: LayoutCandidate[],
  request: GenerateLayoutRequest,
) {
  const repairedCandidates = candidates.map((candidate) =>
    repairCandidate(candidate, request),
  );

  return validateCandidates(repairedCandidates, request, "ai");
}
