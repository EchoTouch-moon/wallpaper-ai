import type { ImageAsset } from "@/types/asset";

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
    return {
      id: `asset_${crypto.randomUUID()}`,
      name: file.name,
      objectUrl,
      thumbnailUrl: objectUrl,
      width,
      height,
      aspectRatio: width / height,
      metadata: {
        orientation: getOrientation(width, height),
      },
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}
