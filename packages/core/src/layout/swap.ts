import type { WallpaperLayout } from "../types/layout";

interface AssetSize {
  id: string;
  width: number;
  height: number;
}

export function swapLayoutItemAssets(
  layout: WallpaperLayout,
  idA: string,
  idB: string,
  assets: AssetSize[],
): WallpaperLayout {
  const itemA = layout.items.find((item) => item.id === idA);
  const itemB = layout.items.find((item) => item.id === idB);

  if (!itemA || !itemB) {
    return layout;
  }

  const assetsById = new Map(assets.map((a) => [a.id, a]));

  const newItems = layout.items.map((item) => {
    if (item.id === idA) {
      const otherItem = itemB;
      const asset = assetsById.get(otherItem.assetId);
      let crop = item.crop;
      if (asset && asset.width && asset.height) {
        const slotAspect = item.width / item.height;
        const originalWidth = asset.width;
        const originalHeight = asset.height;
        let cropWidth = originalWidth;
        let cropHeight = originalHeight;

        if (originalWidth / originalHeight > slotAspect) {
          cropWidth = originalHeight * slotAspect;
        } else {
          cropHeight = originalWidth / slotAspect;
        }

        crop = {
          x: (originalWidth - cropWidth) / 2 / originalWidth,
          y: (originalHeight - cropHeight) / 2 / originalHeight,
          width: cropWidth / originalWidth,
          height: cropHeight / originalHeight,
        };
      }
      return {
        ...item,
        assetId: otherItem.assetId,
        crop,
      };
    }
    if (item.id === idB) {
      const otherItem = itemA;
      const asset = assetsById.get(otherItem.assetId);
      let crop = item.crop;
      if (asset && asset.width && asset.height) {
        const slotAspect = item.width / item.height;
        const originalWidth = asset.width;
        const originalHeight = asset.height;
        let cropWidth = originalWidth;
        let cropHeight = originalHeight;

        if (originalWidth / originalHeight > slotAspect) {
          cropWidth = originalHeight * slotAspect;
        } else {
          cropHeight = originalWidth / slotAspect;
        }

        crop = {
          x: (originalWidth - cropWidth) / 2 / originalWidth,
          y: (originalHeight - cropHeight) / 2 / originalHeight,
          width: cropWidth / originalWidth,
          height: cropHeight / originalHeight,
        };
      }
      return {
        ...item,
        assetId: otherItem.assetId,
        crop,
      };
    }
    return item;
  });

  return {
    ...layout,
    items: newItems,
  };
}
