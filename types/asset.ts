export interface ImageAsset {
  id: string;
  name: string;
  objectUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  aspectRatio: number;
  metadata: {
    orientation: "landscape" | "portrait" | "square";
    quality?: number;
    dominantColors?: string[];
    bestUse?: "hero-or-background" | "support";
  };
}
