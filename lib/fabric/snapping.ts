import type { Canvas, FabricObject } from "fabric";
import type { SnapGuides } from "@/types/canvas";

interface SnapCandidate {
  value: number;
}

interface SnapResult {
  delta: number;
  guide?: number;
}

interface SnappableObject extends FabricObject {
  role?: "hero" | "support" | "background";
}

function getAxisAnchors(start: number, size: number) {
  return [start, start + size / 2, start + size];
}

export function findClosestSnap(
  anchors: number[],
  candidates: SnapCandidate[],
  threshold: number,
): SnapResult {
  let closest: SnapResult = { delta: 0 };
  let closestDistance = threshold;

  for (const anchor of anchors) {
    for (const candidate of candidates) {
      const delta = candidate.value - anchor;
      const distance = Math.abs(delta);
      if (distance < closestDistance) {
        closest = { delta, guide: candidate.value };
        closestDistance = distance;
      }
    }
  }

  return closest;
}

export function snapObjectToGeometry(
  canvas: Canvas,
  target: FabricObject,
  documentWidth: number,
  documentHeight: number,
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
  const threshold = 8 / Math.max(canvas.getZoom(), 0.01);
  const xSnap = findClosestSnap(
    getAxisAnchors(bounds.left, bounds.width),
    xCandidates,
    threshold,
  );
  const ySnap = findClosestSnap(
    getAxisAnchors(bounds.top, bounds.height),
    yCandidates,
    threshold,
  );

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
