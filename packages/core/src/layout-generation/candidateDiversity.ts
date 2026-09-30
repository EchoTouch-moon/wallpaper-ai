import type { LayoutCandidate } from "../types/layout.ts";

function normalizedGeometryDistance(
  left: LayoutCandidate,
  right: LayoutCandidate,
) {
  const leftBySlot = new Map(
    left.layout.items.map((item) => [item.slotId ?? item.id, item]),
  );
  const rightBySlot = new Map(
    right.layout.items.map((item) => [item.slotId ?? item.id, item]),
  );
  const slotIds = new Set([...leftBySlot.keys(), ...rightBySlot.keys()]);
  if (slotIds.size === 0) {
    return 0;
  }

  let total = 0;
  slotIds.forEach((slotId) => {
    const leftItem = leftBySlot.get(slotId);
    const rightItem = rightBySlot.get(slotId);
    if (!leftItem || !rightItem) {
      total += 1;
      return;
    }
    const leftCanvas = left.layout.canvas;
    const rightCanvas = right.layout.canvas;
    total +=
      (Math.abs(leftItem.x / leftCanvas.width - rightItem.x / rightCanvas.width) +
        Math.abs(leftItem.y / leftCanvas.height - rightItem.y / rightCanvas.height) +
        Math.abs(
          leftItem.width / leftCanvas.width -
            rightItem.width / rightCanvas.width,
        ) +
        Math.abs(
          leftItem.height / leftCanvas.height -
            rightItem.height / rightCanvas.height,
        )) /
      4;
  });

  return Math.min(1, total / slotIds.size);
}

export function candidateDiversityScore(
  left: LayoutCandidate,
  right: LayoutCandidate,
) {
  const leftRecipe = left.layout.template?.recipe;
  const rightRecipe = right.layout.template?.recipe;
  let score = normalizedGeometryDistance(left, right) * 0.35;

  if (left.layout.template?.type !== right.layout.template?.type) {
    score += 0.2;
  }
  if (leftRecipe?.family !== rightRecipe?.family) {
    score += 0.2;
  }
  if (leftRecipe?.profile !== rightRecipe?.profile) {
    score += 0.1;
  }
  if (leftRecipe?.rhythm !== rightRecipe?.rhythm) {
    score += 0.06;
  }
  if (leftRecipe?.boundary !== rightRecipe?.boundary) {
    score += 0.04;
  }
  if (leftRecipe && rightRecipe) {
    score += Math.min(0.05, Math.abs(leftRecipe.heroShare - rightRecipe.heroShare));
  }

  return Math.min(1, Number(score.toFixed(4)));
}

export interface DiverseCandidateSelection {
  candidates: LayoutCandidate[];
  skippedCandidateIds: string[];
}

export function selectDiverseLayoutCandidates(
  primary: LayoutCandidate[],
  fallback: LayoutCandidate[],
  count: number,
  minimumScore = 0.18,
): DiverseCandidateSelection {
  const selected: LayoutCandidate[] = [];
  const skippedCandidateIds: string[] = [];

  for (const candidate of [...primary, ...fallback]) {
    if (selected.some((item) => item.id === candidate.id)) {
      continue;
    }
    const diverse = selected.every(
      (item) => candidateDiversityScore(item, candidate) >= minimumScore,
    );
    if (!diverse) {
      skippedCandidateIds.push(candidate.id);
      continue;
    }
    selected.push(candidate);
    if (selected.length >= count) {
      break;
    }
  }

  return { candidates: selected, skippedCandidateIds };
}
