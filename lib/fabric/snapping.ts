import type { Canvas, FabricObject } from "fabric";
import type { SnapGuides } from "@/types/canvas";

interface SnapCandidate {
  value: number;
}

interface SnapResult {
  delta: number;
  guide?: number;
}

export interface AxisSnapLock {
  anchorIndex: number;
  guide: number;
}

export interface SnapSession {
  target: FabricObject | null;
  x: AxisSnapLock | null;
  y: AxisSnapLock | null;
}

interface SnappableObject extends FabricObject {
  role?: "hero" | "support" | "background";
}

const SNAP_THRESHOLD_PX = 5; // Visual guide line visibility threshold (in pixels)
const SNAP_RELEASE_THRESHOLD_PX = 6; // Unused for snap-less guidelines

function getAxisAnchors(start: number, size: number) {
  return [start, start + size / 2, start + size];
}

function findClosestSnapMatch(
  anchors: number[],
  candidates: SnapCandidate[],
  threshold: number,
) {
  let closest:
    | {
        anchorIndex: number;
        delta: number;
        guide: number;
      }
    | undefined;
  let closestDistance = threshold;

  anchors.forEach((anchor, anchorIndex) => {
    candidates.forEach((candidate) => {
      const delta = candidate.value - anchor;
      const distance = Math.abs(delta);
      if (distance < closestDistance) {
        closest = {
          anchorIndex,
          delta,
          guide: candidate.value,
        };
        closestDistance = distance;
      }
    });
  });

  return closest;
}

export function findClosestSnap(
  anchors: number[],
  candidates: SnapCandidate[],
  threshold: number,
): SnapResult {
  const closest = findClosestSnapMatch(anchors, candidates, threshold);
  return closest
    ? { delta: closest.delta, guide: closest.guide }
    : { delta: 0 };
}

export function resolveAxisSnap(
  anchors: number[],
  candidates: SnapCandidate[],
  threshold: number,
  releaseThreshold: number,
  lock: AxisSnapLock | null,
) {
  if (lock) {
    const lockedAnchor = anchors[lock.anchorIndex];
    if (
      lockedAnchor !== undefined &&
      Math.abs(lock.guide - lockedAnchor) <= releaseThreshold
    ) {
      return {
        result: {
          delta: lock.guide - lockedAnchor,
          guide: lock.guide,
        },
        lock,
      };
    }
  }

  const closest = findClosestSnapMatch(anchors, candidates, threshold);
  if (!closest) {
    return {
      result: { delta: 0 },
      lock: null,
    };
  }

  const nextLock = {
    anchorIndex: closest.anchorIndex,
    guide: closest.guide,
  };
  return {
    result: {
      delta: closest.delta,
      guide: closest.guide,
    },
    lock: nextLock,
  };
}

export function createSnapSession(): SnapSession {
  return {
    target: null,
    x: null,
    y: null,
  };
}

export function resetSnapSession(
  session: SnapSession,
  target: FabricObject | null = null,
) {
  session.target = target;
  session.x = null;
  session.y = null;
}

export function snapObjectToGeometry(
  canvas: Canvas,
  target: FabricObject,
  documentWidth: number,
  documentHeight: number,
  session: SnapSession,
): SnapGuides {
  const xCandidates: SnapCandidate[] = [
    { value: 0 },
    { value: documentWidth / 2 },
    { value: documentWidth },
  ];
  const yCandidates: SnapCandidate[] = [
    { value: 0 },
    { value: documentHeight / 2 },
    { value: documentHeight },
  ];

  const bounds = target.getBoundingRect();
  const zoom = Math.max(canvas.getZoom(), 0.01);
  const threshold = SNAP_THRESHOLD_PX / zoom;

  const xClosest = findClosestSnapMatch(
    getAxisAnchors(bounds.left, bounds.width),
    xCandidates,
    threshold,
  );
  const yClosest = findClosestSnapMatch(
    getAxisAnchors(bounds.top, bounds.height),
    yCandidates,
    threshold,
  );

  return {
    vertical: xClosest ? [xClosest.guide] : [],
    horizontal: yClosest ? [yClosest.guide] : [],
  };
}
