import type { WallpaperLayout } from "@/types/layout";

export function swapLayoutItemAssets(
  layout: WallpaperLayout,
  idA: string,
  idB: string,
): WallpaperLayout {
  const itemA = layout.items.find((item) => item.id === idA);
  const itemB = layout.items.find((item) => item.id === idB);

  if (!itemA || !itemB) {
    return layout;
  }

  const newItems = layout.items.map((item) => {
    if (item.id === idA) {
      return {
        ...item,
        assetId: itemB.assetId,
      };
    }
    if (item.id === idB) {
      return {
        ...item,
        assetId: itemA.assetId,
      };
    }
    return item;
  });

  return {
    ...layout,
    items: newItems,
  };
}
