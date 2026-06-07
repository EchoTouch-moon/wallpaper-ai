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

const SNAP_THRESHOLD_PX = 8;
const SNAP_RELEASE_THRESHOLD_PX = 14;

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
  if (session.target !== target) {
    resetSnapSession(session, target);
  }

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

  canvas.getObjects().forEach((object) => {
    const snappable = object as SnappableObject;
    if (
      object === target ||
      object.isDescendantOf(target) ||
      snappable.role === "background" ||
      !object.visible
    ) {
      return;
    }

    const bounds = object.getBoundingRect();
    getAxisAnchors(bounds.left, bounds.width).forEach((value) =>
      xCandidates.push({ value }),
    );
    getAxisAnchors(bounds.top, bounds.height).forEach((value) =>
      yCandidates.push({ value }),
    );
  });

  const bounds = target.getBoundingRect();
  const zoom = Math.max(canvas.getZoom(), 0.01);
  const threshold = SNAP_THRESHOLD_PX / zoom;
  const releaseThreshold = SNAP_RELEASE_THRESHOLD_PX / zoom;
  const xState = resolveAxisSnap(
    getAxisAnchors(bounds.left, bounds.width),
    xCandidates,
    threshold,
    releaseThreshold,
    session.x,
  );
  const yState = resolveAxisSnap(
    getAxisAnchors(bounds.top, bounds.height),
    yCandidates,
    threshold,
    releaseThreshold,
    session.y,
  );
  const xSnap = xState.result;
  const ySnap = yState.result;
  session.x = xState.lock;
  session.y = yState.lock;

  if (xSnap.guide !== undefined || ySnap.guide !== undefined) {
    target.set({
      left: target.left + xSnap.delta,
      top: target.top + ySnap.delta,
    });
    target.setCoords();
  }

  return {
    vertical: xSnap.guide === undefined ? [] : [xSnap.guide],
    horizontal: ySnap.guide === undefined ? [] : [ySnap.guide],
  };
}
