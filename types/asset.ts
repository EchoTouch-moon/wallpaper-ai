export interface ImageAsset {
  id: string;
  src: string;
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
