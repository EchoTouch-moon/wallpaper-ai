export const STYLE_PRESETS = [
  "minimal-whitespace",
  "film-collage",
  "dark-desktop",
  "hero-background",
] as const;

export type StylePreset = (typeof STYLE_PRESETS)[number];
