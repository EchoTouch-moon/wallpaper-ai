import {
  FabricImage,
  Rect,
  Shadow,
  type Canvas as FabricCanvas,
} from "fabric";
import { layoutItemToFabricGeometry } from "@/lib/fabric/layoutGeometry";
import type { ImageAsset } from "@/types/asset";
import type { WallpaperItem, WallpaperLayout } from "@/types/layout";

export interface LayoutFabricImage extends FabricImage {
  objectId?: string;
  assetId?: string;
  slotId?: string;
  role?: WallpaperItem["role"];
  layoutCrop?: WallpaperItem["crop"];
  layoutStyle?: WallpaperItem["style"];
  layoutMask?: WallpaperItem["mask"];
}

async function createLayoutImage(item: WallpaperItem, asset: ImageAsset) {
  const image = (await FabricImage.fromURL(asset.objectUrl)) as LayoutFabricImage;
  const original = image.getOriginalSize();
  const geometry = layoutItemToFabricGeometry(item, original);

  Object.assign(image, {
    objectId: item.id,
    assetId: item.assetId,
    slotId: item.slotId,
    role: item.role,
    layoutCrop: item.crop,
    layoutStyle: item.style,
    layoutMask: item.mask,
  });
  image.set({
    left: geometry.left,
    top: geometry.top,
    originX: "center",
    originY: "center",
    width: geometry.width,
    height: geometry.height,
    cropX: geometry.cropX,
    cropY: geometry.cropY,
    scaleX: geometry.scaleX,
    scaleY: geometry.scaleY,
    angle: item.rotation,
    opacity: item.opacity,
    stroke: item.style?.border?.color,
    strokeWidth: item.style?.border?.width ?? 0,
    paintFirst: "stroke",
    cornerStyle: "circle",
    cornerColor: "#ffffff",
    cornerStrokeColor: "#168cff",
    borderColor: "#62b1ff",
    transparentCorners: false,
    padding: 3,
  });

  const radius = item.style?.radius ?? item.mask?.radius ?? 0;
  if (radius > 0) {
    const scale = Math.max(Math.abs(image.scaleX), 0.001);
    image.clipPath = new Rect({
      width: geometry.width,
      height: geometry.height,
      rx: radius / scale,
      ry: radius / scale,
      originX: "center",
      originY: "center",
    });
  }
  if (item.style?.shadow && item.style.shadow !== "none") {
    image.shadow = new Shadow({
      color:
        item.style.shadow === "strong"
          ? "rgba(24, 34, 50, 0.34)"
          : "rgba(24, 34, 50, 0.2)",
      blur: item.style.shadow === "strong" ? 36 : 22,
      offsetX: 0,
      offsetY: item.style.shadow === "strong" ? 18 : 10,
    });
  }
  image.setCoords();
  return image;
}

export async function applyLayoutToCanvas(
  canvas: FabricCanvas,
  layout: WallpaperLayout,
  assets: ImageAsset[],
) {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const images = await Promise.all(
    [...layout.items]
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((item) => {
        const asset = assetsById.get(item.assetId);
        if (!asset) {
          throw new Error(`Missing asset: ${item.assetId}`);
        }
        return createLayoutImage(item, asset);
      }),
  );

  canvas.discardActiveObject();
  canvas.remove(...canvas.getObjects());
  canvas.backgroundColor = layout.canvas.backgroundColor;
  canvas.add(...images);
  canvas.requestRenderAll();
}
