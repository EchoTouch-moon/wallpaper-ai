import type { WallpaperItem } from "@/types/layout";

interface OriginalSize {
  width: number;
  height: number;
}

export interface FabricImageGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  cropX: number;
  cropY: number;
  scaleX: number;
  scaleY: number;
}

export function layoutItemToFabricGeometry(
  item: WallpaperItem,
  original: OriginalSize,
): FabricImageGeometry {
  const crop = item.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const width = crop.width * original.width;
  const height = crop.height * original.height;
  return {
    left: item.x + item.width / 2,
    top: item.y + item.height / 2,
    width,
    height,
    cropX: crop.x * original.width,
    cropY: crop.y * original.height,
    scaleX: item.width / width,
    scaleY: item.height / height,
  };
}

export function fabricGeometryToLayoutItem(
  geometry: FabricImageGeometry,
  original: OriginalSize,
) {
  const scaledWidth = geometry.width * geometry.scaleX;
  const scaledHeight = geometry.height * geometry.scaleY;
  return {
    x: geometry.left - scaledWidth / 2,
    y: geometry.top - scaledHeight / 2,
    width: scaledWidth,
    height: scaledHeight,
    crop: {
      x: geometry.cropX / original.width,
      y: geometry.cropY / original.height,
      width: geometry.width / original.width,
      height: geometry.height / original.height,
    },
  };
}
