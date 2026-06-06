# Wallpaper composition strategy

This document defines the first-pass layout rules that the future AI layout
service should follow. AI should select a composition intent and transition
strategy, then return editable geometry rather than a flattened image.

## Photo ratio decisions

### Landscape photos

- Prefer one landscape image as the hero for 16:9, 16:10, and 21:9 canvases.
- If the source is not wide enough, extend it with a blurred duplicate rather
  than stretching or aggressively cropping the subject.
- Reserve quiet sky, wall, water, or defocused background for desktop icons.

### Portrait photos

- On desktop wallpapers, keep portrait images as clear foreground cards over a
  color-matched or blurred full-canvas background.
- Two portraits work well as an offset pair; three or more should use a
  consistent baseline and controlled size rhythm.
- On 9:16 and 9:19.5 canvases, a strong portrait can become full-bleed while
  preserving the top clock area.

### Square photos

- Treat square images as modular support images rather than stretching them.
- Use a hero plus one or two square supports, or a balanced grid with generous
  outer margins.
- Vary scale before varying rotation; excessive rotation makes wallpaper feel
  like a scrapbook rather than a calm background.

### Mixed ratios

- Choose the widest high-quality image as the background or hero.
- Preserve portrait and square images as foreground layers.
- Align images by subject eye line, horizon, or a shared edge rather than by
  their raw bounding boxes.

## Transition hierarchy

1. **Blurred extension**: best when a single hero does not cover the canvas.
   Duplicate the hero behind itself, cover the canvas, blur it, reduce contrast,
   and add a subtle color wash.
2. **Soft gradient feather**: best for adjacent images with compatible light and
   color. Blend only the meeting edge; keep faces and important subjects sharp.
3. **Shared color wash**: best for images from different scenes. Extract a common
   neutral or dominant color and place it behind all images to unify them.
4. **Overlap and soft shadow**: best for a hero with support cards. Overlap only
   slightly and use one consistent shadow direction.
5. **Clean gap**: best when colors conflict. A deliberate 24-64 px gap is better
   than a muddy crossfade.

Avoid direct full-image crossfades. They create double subjects and unclear
focal hierarchy. Transition masks should stay outside detected faces and salient
subjects.

## AI layout contract

The AI input should include canvas ratio, safe areas, asset dimensions,
orientation, quality, dominant colors, and the selected composition intent.
The output should include editable item geometry plus:

- focal asset;
- visual flow;
- transition type, strength, and feather width;
- whether faces and negative space must be preserved.

The renderer remains responsible for validating coordinates and applying the
transition safely.
