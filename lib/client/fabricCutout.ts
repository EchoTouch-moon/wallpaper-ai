import { FabricImage, Polygon, type Canvas as FabricCanvas } from "fabric";
import type { ImageAsset, WallpaperLayout } from "@wallpaper/core/types";
import {
  computeSlotPlacement,
  subjectPolygonOf,
  type PixelRect,
} from "./cutoutGeometry.ts";

/**
 * Editor-canvas counterpart of the browser export's cutout rendering.
 *
 * core's applyLayoutToCanvas places every item by stretching its crop frame
 * to the slot rect (cover-style). Items with treatment "full"/"cutout" need
 * contain semantics instead, and "cutout" additionally clips the image to
 * the asset's subject polygon. This pass runs right after applyLayoutToCanvas
 * and rewrites only those objects, so "crop" items keep byte-identical
 * behavior:
 *
 * - contain: uniform scale = min(slot.w / content.w, slot.h / content.h),
 *   content (polygon bbox, or the crop frame when no polygon exists)
 *   centered in the slot, fully visible.
 * - clip: a non-absolute Polygon clipPath in the image's local space
 *   (origin at the object center), so the clip follows the object through
 *   moves, scaling and rotation. NB: it replaces a slot-radius clipPath —
 *   Fabric supports a single clipPath per object.
 */

interface TreatmentFabricImage extends FabricImage {
  objectId?: string;
  assetId?: string;
}

export function applySlotTreatmentsToCanvas(
  canvas: FabricCanvas,
  layout: WallpaperLayout,
  assets: ImageAsset[],
): boolean {
  const itemsById = new Map(layout.items.map((item) => [item.id, item]));
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  let changed = false;

  for (const object of canvas.getObjects()) {
    if (!(object instanceof FabricImage)) {
      continue;
    }
    const image = object as TreatmentFabricImage;
    const item = image.objectId ? itemsById.get(image.objectId) : undefined;
    if (!item || item.treatment === "crop") {
      continue;
    }

    const asset = assetsById.get(item.assetId);
    const polygon =
      item.treatment === "cutout" ? subjectPolygonOf(asset?.analysis) : null;
    const slot: PixelRect = {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    };
    const placement = computeSlotPlacement({
      slot,
      imageSize: image.getOriginalSize(),
      crop: item.crop,
      polygon,
    });
    if (!placement) {
      continue;
    }

    image.set({
      left: placement.frameCenter.x,
      top: placement.frameCenter.y,
      scaleX: placement.scale,
      scaleY: placement.scale,
      dirty: true,
    });
    if (placement.clipPolygon) {
      // No explicit left/top: the Polygon renders its points verbatim in the
      // target object's local space (pathOffset keeps them in place).
      image.clipPath = new Polygon(placement.clipPolygon, {
        objectCaching: false,
      });
    }
    image.setCoords();
    changed = true;
  }

  if (changed) {
    canvas.requestRenderAll();
  }
  return changed;
}
