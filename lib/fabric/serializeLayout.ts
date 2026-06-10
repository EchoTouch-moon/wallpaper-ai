import { FabricImage, type Canvas as FabricCanvas } from "fabric";
import { fabricGeometryToLayoutItem } from "@/lib/fabric/layoutGeometry";
import { wallpaperLayoutSchema } from "@/lib/layout/layoutSchema";
import type { LayoutFabricImage } from "@/lib/fabric/applyLayout";
import type { WallpaperLayout } from "@/types/layout";

export function serializeCanvasLayout(
  canvas: FabricCanvas,
  baseLayout: WallpaperLayout,
) {
  const items = canvas
    .getObjects()
    .filter((object): object is LayoutFabricImage => object instanceof FabricImage)
    .map((image, zIndex) => {
      const original = image.getOriginalSize();
      const geometry = fabricGeometryToLayoutItem(
        {
          left: image.left,
          top: image.top,
          width: image.width,
          height: image.height,
          cropX: image.cropX,
          cropY: image.cropY,
          scaleX: image.scaleX,
          scaleY: image.scaleY,
        },
        original,
      );
      return {
        id: image.objectId ?? `item_${zIndex + 1}`,
        assetId: image.assetId ?? "",
        slotId: image.slotId,
        role: image.role ?? "support",
        x: Math.round(geometry.x),
        y: Math.round(geometry.y),
        width: Math.round(geometry.width),
        height: Math.round(geometry.height),
        rotation: image.angle,
        zIndex,
        opacity: image.opacity,
        fit: "cover" as const,
        crop: {
          ...geometry.crop,
          focalPoint: image.layoutCrop?.focalPoint,
        },
        mask: image.layoutMask,
        style: image.layoutStyle,
      };
    });

  return wallpaperLayoutSchema.parse({
    ...baseLayout,
    canvas: {
      ...baseLayout.canvas,
      backgroundColor: typeof canvas.backgroundColor === "string" ? canvas.backgroundColor : baseLayout.canvas.backgroundColor,
    },
    items,
  });
}
