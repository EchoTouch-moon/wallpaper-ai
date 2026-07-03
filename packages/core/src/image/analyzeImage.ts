import { analyzePixels } from "./colorAnalysis";
import type { ImageAssetAnalysis } from "../types/layout";

const SAMPLE_LIMIT = 96;

function loadImage(objectUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to analyze image"));
    image.src = objectUrl;
  });
}

export async function analyzeImage(
  assetId: string,
  objectUrl: string,
  width: number,
  height: number,
): Promise<ImageAssetAnalysis> {
  const image = await loadImage(objectUrl);
  const scale = Math.min(SAMPLE_LIMIT / width, SAMPLE_LIMIT / height, 1);
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Image analysis canvas is unavailable");
  }

  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;

  return analyzePixels({ assetId, width, height, pixels });
}
