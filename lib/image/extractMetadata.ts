import type { ImageAsset } from "@/types/asset";
import { analyzeImage } from "@/lib/image/analyzeImage";

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function getOrientation(width: number, height: number): ImageAsset["metadata"]["orientation"] {
  if (width === height) {
    return "square";
  }
  return width > height ? "landscape" : "portrait";
}

function loadImageDimensions(objectUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => reject(new Error("Unable to read image dimensions"));
    image.src = objectUrl;
  });
}

export async function createImageAsset(file: File): Promise<ImageAsset> {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new Error(`${file.name} is not a supported image`);
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const { width, height } = await loadImageDimensions(objectUrl);
    const id = `asset_${crypto.randomUUID()}`;
    const analysis = await analyzeImage(id, objectUrl, width, height);
    return {
      id,
      name: file.name,
      objectUrl,
      thumbnailUrl: objectUrl,
      width,
      height,
      aspectRatio: width / height,
      mimeType: file.type,
      analysis,
      metadata: {
        orientation: getOrientation(width, height),
        quality: analysis.resolutionScore,
        dominantColors: analysis.dominantColors,
        bestUse:
          analysis.bestUse?.includes("hero") ||
          analysis.bestUse?.includes("background")
            ? "hero-or-background"
            : "support",
      },
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}
