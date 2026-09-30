# Notes: One Touch AI Composer

## Current State

- `OneTouchStudio` is a polished client-only demo. It uses six remote sample images, a hard-coded mosaic, and a hard-coded export layout.
- `/api/generate-layout` already supports canvas dimensions, ratio presets, user prompts, safe-area intent, multiple candidates, AI/fallback modes, and strict validation.
- The AI planner may only choose registered template IDs and assign images/crops.
- Registered templates cover desktop/mobile ratios but mostly require 3–5 images.
- Browser image analysis currently extracts dimensions and pixel/color statistics; semantic fields exist in the schema but are not populated.
- `WallpaperLayout` already contains normalized geometry, roles, crop data, safe areas, guidance, transitions, and boundaries.
- The Editor owns useful rendering/export utilities but should no longer be the primary product surface.

## Target Architecture

- Explicit controls plus natural language produce a `CompositionBrief`.
- The planner outputs a constrained `TemplateRecipe` and role assignments.
- A deterministic compiler converts recipes to valid `WallpaperTemplate` slots.
- Existing materialization and validation produce portable `WallpaperLayout` candidates.
- The main page renders selected candidates directly and offers language-based refinement.
- Fixed templates remain as fallback and compatibility paths.

## Defaults

- Prompt is optional; blank means automatic composition.
- Candidate profiles are safe, editorial, and dynamic.
- Explicit hero/safe-area controls override inferred prompt intent.
- Custom dimensions: each side 720–7680px, total no more than 33MP, aspect ratio 0.4–3.
- JPEG/PNG/WebP, 20MB and 50MP maximum per image.

## Implemented Protocol Changes

- AI candidates may now reference either a registered `templateId` or a generated `TemplateRecipe`, never both.
- Generated layouts preserve their recipe and `source: "generated"` provenance.
- Registered templates continue to be checked against the registry; generated templates are checked for a valid recipe.
- Composer requests support 2–6 analyzed assets and exactly three differentiated candidates.
- Explicit hero selection is materialized by swapping the chosen asset into the hero slot and recalculating both affected crops.
- Custom targets retain `ratio: "custom"` in the final layout while using the closest known ratio only for legacy planning heuristics.
- Deterministic Chinese/English refinement currently covers spacing, density, hero scale, order/dynamic rhythm, and hero direction.
- The same composition/refinement contract can use an OpenAI-compatible provider; invalid or duplicate model candidates are repaired per candidate.
- Semantic vision analysis is opt-in through `VISION_ENABLED` and `VISION_MODEL`; uploads remain functional when it is unavailable.
- Preview, animation, and export now share `WallpaperLayout`; no fixed mosaic/export slot table remains in the main Studio.
