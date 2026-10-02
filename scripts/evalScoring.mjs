// Extracted scoring primitives for composition candidates, shared by
// scripts/eval-compositions.mjs (deterministic fixture baseline) and external
// experiment harnesses (e.g. temp/experiment-dsv41.mjs). Extracted verbatim
// from eval-compositions.mjs — behavior is guarded byte-for-byte by that
// script's `--check` baseline; do not change semantics here without
// regenerating eval/reports/baseline.json.
//
// Each candidate is scored with three heuristics, each normalized to [0, 1]:
//
//   1. focusFidelity     — does each slot's crop cover the subject the slot
//                          points at (saliencyCenter / subjectBox / faces)?
//   2. safeAreaAdherence — how much do slot rectangles overlap reserved
//                          safe areas (clock strip, dock, icon column)?
//   3. colorHarmony      — average-color distance between spatially adjacent
//                          slots (lower distance → higher score).

import { colorDistance, hexToHsl } from "@wallpaper/core/image";

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

export function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

export function mean(values) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function intersectionArea(a, b) {
  const width =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export function round6(value) {
  return Number(value.toFixed(6));
}

// ---------------------------------------------------------------------------
// Metric 1: focus fidelity
// ---------------------------------------------------------------------------

// Reference focus priority mirrors calculateCoverCrop
// (packages/core/src/layout/planTemplate.ts:45-69): mean face center >
// subjectBox center > saliencyCenter > image center. subjectBox therefore
// participates through its center point — a deliberately simple, conservative
// reading of "crop covers saliencyCenter/subjectBox".
export function referenceFocus(analysis) {
  if (analysis.faces && analysis.faces.length > 0) {
    const centers = analysis.faces.map((face) => ({
      x: face.x + face.width / 2,
      y: face.y + face.height / 2,
    }));
    return {
      x: mean(centers.map((center) => center.x)),
      y: mean(centers.map((center) => center.y)),
    };
  }
  if (analysis.subjectBox) {
    return {
      x: analysis.subjectBox.x + analysis.subjectBox.width / 2,
      y: analysis.subjectBox.y + analysis.subjectBox.height / 2,
    };
  }
  if (analysis.saliencyCenter) {
    return { ...analysis.saliencyCenter };
  }
  return { x: 0.5, y: 0.5 };
}

export function itemFocusScore(item, analysis) {
  // A missing crop means "show the whole image" — equivalent to a full crop box.
  const crop = item.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const focus = referenceFocus(analysis);
  const eps = 1e-6; // floating-point tolerance for on-edge containment

  const inside =
    focus.x >= crop.x - eps &&
    focus.x <= crop.x + crop.width + eps &&
    focus.y >= crop.y - eps &&
    focus.y <= crop.y + crop.height + eps;
  if (inside) {
    return 1;
  }

  // Outside the crop: linear decay by the normalized Euclidean distance from
  // the crop box (each axis normalized by the crop's own size, so narrow
  // crops penalize misses faster).
  const dx =
    Math.max(crop.x - focus.x, focus.x - (crop.x + crop.width), 0) /
    crop.width;
  const dy =
    Math.max(crop.y - focus.y, focus.y - (crop.y + crop.height), 0) /
    crop.height;
  return Math.max(0, 1 - Math.hypot(dx, dy));
}

// The brief asks specifically about the hero ("main") slot, so the hero item
// gets half the weight and all supporting items share the other half. With no
// supporting slots the hero score stands alone.
export function candidateFocusScore(candidate, analysisById) {
  const items = candidate.layout.items;
  const heroScore = mean(
    items
      .filter((item) => item.role === "hero")
      .map((item) => itemFocusScore(item, analysisById.get(item.assetId))),
  );
  const supportScore = mean(
    items
      .filter((item) => item.role !== "hero")
      .map((item) => itemFocusScore(item, analysisById.get(item.assetId))),
  );

  if (heroScore === null) {
    return supportScore ?? 0;
  }
  if (supportScore === null) {
    return heroScore;
  }
  return heroScore * 0.5 + supportScore * 0.5;
}

// ---------------------------------------------------------------------------
// Metric 2: safe-area adherence
// ---------------------------------------------------------------------------

// Overlap is measured with axis-aligned bounding boxes (item rotation is at
// most ±1.4° in current recipes and is deliberately ignored), summed per safe
// area without de-duplication and without discounting for opacity/zIndex —
// the simple conservative reading of "does slot geometry conflict with the
// reserved area". A layout without safe areas has nothing to violate: 1.
export function candidateSafeAreaScore(candidate) {
  const { safeAreas, items } = candidate.layout;
  if (safeAreas.length === 0) {
    return 1;
  }
  const occupancyRates = safeAreas.map((area) => {
    const areaSize = area.width * area.height;
    let overlap = 0;
    for (const item of items) {
      overlap += intersectionArea(item, area);
    }
    return clamp01(overlap / areaSize);
  });
  return 1 - (mean(occupancyRates) ?? 0);
}

// ---------------------------------------------------------------------------
// Metric 3: color harmony
// ---------------------------------------------------------------------------

// Adjacent = positive-area intersection between item bounding boxes (so
// overlapping/layered layouts count, clean-gap layouts do not). When a layout
// has no adjacent pairs at all, the metric conservatively falls back to the
// mean over all pairs so the score stays comparable across templates.
// Distances reuse colorDistance/hexToHsl from @wallpaper/core/image; "harmony"
// is read as "smaller average-color distance between adjacent slots is
// better", mapped by 1 - meanDistance.
export function candidateColorScore(candidate, analysisById) {
  const items = candidate.layout.items;
  const pairCandidates = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (intersectionArea(items[i], items[j]) > 0) {
        pairCandidates.push([i, j]);
      }
    }
  }
  let pairs = pairCandidates;
  if (pairs.length === 0) {
    pairs = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        pairs.push([i, j]);
      }
    }
  }
  if (pairs.length === 0) {
    return 1;
  }

  const distances = pairs.map(([left, right]) =>
    colorDistance(
      hexToHsl(analysisById.get(items[left].assetId).averageColor),
      hexToHsl(analysisById.get(items[right].assetId).averageColor),
    ),
  );
  return 1 - clamp01(mean(distances));
}

// ---------------------------------------------------------------------------
// Candidate-level aggregate
// ---------------------------------------------------------------------------

// Equal-weight mean of the three metrics for a single candidate — the same
// combination eval-compositions.mjs applies across a fixture's candidates.
export function candidateTotalScore(candidate, analysisById) {
  return mean([
    candidateFocusScore(candidate, analysisById),
    candidateSafeAreaScore(candidate),
    candidateColorScore(candidate, analysisById),
  ]);
}
