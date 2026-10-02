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

/**
 * Structural skeleton key (experiment finding 5): (family, heroPosition) is
 * the combination two candidates can share while differing only through
 * profile-style knobs — E3 shipped two hero-grid/top candidates that were the
 * same layout in safe and dynamic clothing.
 */
export function candidateStructuralCombo(candidate: LayoutCandidate) {
  const recipe = candidate.layout.template?.recipe;
  const family = recipe?.family ?? candidate.layout.template?.id ?? "template";
  const heroPosition = recipe?.heroPosition ?? "unspecified";
  return `${family}|${heroPosition}`;
}

// Calibrated against compiled candidates (temp/calibrate-diversity.mjs): same-
// combination pairs that differ only through profile-style knobs measured
// 0.0197–0.1196 apart in normalized geometry (E1-style desktop safe-vs-dynamic
// hero-grid 0.0664; E3-style mobile hero-grid top 0.1196), while legitimate
// same-combination variation measured 0.1424 (heroShare 0.40 vs 0.76), 0.1740
// (0.32 vs 0.76), and 0.3671 (supportCount 1 vs 3). 0.13 sits between the two
// bands with margin on both sides.
export const SAME_COMBINATION_GEOMETRY_FLOOR = 0.13;

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
    // Same-combination near-duplicate guard: a candidate whose
    // (family, heroPosition) already sits in the selected set is rejected only
    // when the compiled geometry is still similar, so the slot frees up for a
    // candidate from another family (balanced-mosaic / layered-collage) while
    // genuinely different geometry within the same combination survives.
    const combinationDistinct = selected.every(
      (item) =>
        candidateStructuralCombo(item) !== candidateStructuralCombo(candidate) ||
        normalizedGeometryDistance(item, candidate) >=
          SAME_COMBINATION_GEOMETRY_FLOOR,
    );
    if (!diverse || !combinationDistinct) {
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
