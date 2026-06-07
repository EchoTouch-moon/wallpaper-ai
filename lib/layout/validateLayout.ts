import {
  wallpaperLayoutSchema,
  type WallpaperLayoutInput,
} from "./layoutTypes.ts";

interface ValidationContext {
  assetIds?: Iterable<string>;
  templateIds?: Iterable<string>;
}

export function validateLayout(
  input: WallpaperLayoutInput,
  validationContext: ValidationContext = {},
) {
  const parsed = wallpaperLayoutSchema.safeParse(input);
  if (!parsed.success) {
    return parsed;
  }

  const assetIds = validationContext.assetIds
    ? new Set(validationContext.assetIds)
    : null;
  const templateIds = validationContext.templateIds
    ? new Set(validationContext.templateIds)
    : null;
  const semanticErrors: string[] = [];

  if (
    parsed.data.template &&
    templateIds &&
    !templateIds.has(parsed.data.template.id)
  ) {
    semanticErrors.push(`Unknown template: ${parsed.data.template.id}`);
  }

  parsed.data.items.forEach((item) => {
    if (assetIds && !assetIds.has(item.assetId)) {
      semanticErrors.push(`Unknown asset: ${item.assetId}`);
    }
    if (
      item.x < 0 ||
      item.y < 0 ||
      item.x + item.width > parsed.data.canvas.width ||
      item.y + item.height > parsed.data.canvas.height
    ) {
      semanticErrors.push(`Item is outside the canvas: ${item.id}`);
    }
  });

  parsed.data.safeAreas.forEach((area) => {
    if (
      area.x + area.width > parsed.data.canvas.width ||
      area.y + area.height > parsed.data.canvas.height
    ) {
      semanticErrors.push(`Safe area is outside the canvas: ${area.id}`);
    }
  });

  if (semanticErrors.length > 0) {
    return {
      success: false as const,
      error: new Error(semanticErrors.join("; ")),
    };
  }

  return parsed;
}
