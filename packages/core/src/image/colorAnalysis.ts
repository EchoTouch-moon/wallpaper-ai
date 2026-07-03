import type { ImageAssetAnalysis } from "../types/layout";

export interface HslColor {
  hue: number;
  saturation: number;
  lightness: number;
}

interface PixelAnalysisInput {
  assetId: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHsl(red: number, green: number, blue: number): HslColor {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;

  if (delta > 0) {
    if (maximum === r) {
      hue = 60 * (((g - b) / delta) % 6);
    } else if (maximum === g) {
      hue = 60 * ((b - r) / delta + 2);
    } else {
      hue = 60 * ((r - g) / delta + 4);
    }
  }

  if (hue < 0) {
    hue += 360;
  }

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  return { hue, saturation, lightness };
}

export function hexToHsl(hex: string) {
  const { red, green, blue } = hexToRgb(hex);
  return rgbToHsl(red, green, blue);
}

export function colorDistance(left: HslColor, right: HslColor) {
  const hueDistance =
    Math.min(
      Math.abs(left.hue - right.hue),
      360 - Math.abs(left.hue - right.hue),
    ) / 180;
  return (
    0.55 * hueDistance +
    0.25 * Math.abs(left.lightness - right.lightness) +
    0.2 * Math.abs(left.saturation - right.saturation)
  );
}

function getOrientation(width: number, height: number) {
  if (Math.abs(width - height) / Math.max(width, height) < 0.04) {
    return "square" as const;
  }
  return width > height ? ("landscape" as const) : ("portrait" as const);
}

export function calculateResolutionScore(width: number, height: number) {
  const fourKPixels = 3840 * 2160;
  return clamp(Math.sqrt((width * height) / fourKPixels));
}

export function analyzePixels({
  assetId,
  width,
  height,
  pixels,
}: PixelAnalysisInput): ImageAssetAnalysis {
  const histogram = new Map<number, number>();
  const luminances: number[] = [];
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let saturationTotal = 0;
  let visiblePixels = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 16) {
      continue;
    }
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const hsl = rgbToHsl(red, green, blue);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    const key =
      (Math.floor(red / 32) << 6) |
      (Math.floor(green / 32) << 3) |
      Math.floor(blue / 32);

    histogram.set(key, (histogram.get(key) ?? 0) + 1);
    luminances.push(luminance);
    redTotal += red;
    greenTotal += green;
    blueTotal += blue;
    saturationTotal += hsl.saturation;
    visiblePixels += 1;
  }

  if (visiblePixels === 0) {
    throw new Error("Image contains no visible pixels");
  }

  const averageRed = redTotal / visiblePixels;
  const averageGreen = greenTotal / visiblePixels;
  const averageBlue = blueTotal / visiblePixels;
  const brightness =
    luminances.reduce((total, value) => total + value, 0) / visiblePixels;
  const variance =
    luminances.reduce(
      (total, value) => total + (value - brightness) ** 2,
      0,
    ) / visiblePixels;
  const averageColor = rgbToHex(averageRed, averageGreen, averageBlue);
  const dominantColors = [...histogram.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([key]) => {
      const red = Math.min(((key >> 6) & 7) * 32 + 16, 255);
      const green = Math.min(((key >> 3) & 7) * 32 + 16, 255);
      const blue = Math.min((key & 7) * 32 + 16, 255);
      return rgbToHex(red, green, blue);
    });

  while (dominantColors.length < 3) {
    dominantColors.push(averageColor);
  }

  return {
    assetId,
    width,
    height,
    orientation: getOrientation(width, height),
    aspectRatio: width / height,
    resolutionScore: calculateResolutionScore(width, height),
    dominantColors,
    averageColor,
    brightness: clamp(brightness),
    saturation: clamp(saturationTotal / visiblePixels),
    contrast: clamp(Math.sqrt(variance) * 2),
    contentType: "unknown",
    bestUse:
      width >= height
        ? ["hero", "background", "triptych"]
        : ["support", "triptych", "portrait-collage"],
    cropSafety: "medium",
  };
}
