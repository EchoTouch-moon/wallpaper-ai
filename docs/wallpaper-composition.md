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

## Boundary hierarchy

Geometry is resolved before visual transitions. The editor should first make
the image rectangles intentional, then decide whether the meeting edge should
remain visible or be softened.

1. **Edge alignment**: snap image left, center, and right anchors to the canvas
   and to other image anchors. Do the same for top, middle, and bottom anchors.
2. **Crop and focal framing**: choose the image window before arranging the
   composition. Keep the crop window fixed while the source image moves behind
   it, so a face, horizon, or subject remains under direct control.
3. **Spacing rhythm**: use one repeated gap value within a composition. A clean
   gap is a structural choice, not a failed blend.
4. **Layer order and overlap**: use overlap only when one image is clearly the
   hero. Avoid ambiguous tangencies where edges almost meet.
5. **Edge treatment**: add a hairline, shared radius, soft shadow, feather, or
   paper edge only after the geometry reads clearly without decoration.

The current editor implements canvas/object anchor snapping, temporary
non-exported guides, ratio crops, and draggable focal reframing. Equal-gap
distribution and subject-aware anchors remain future geometry tools.

## Editorial versus scrapbook modes

Scrapbook language is useful as an optional rendering vocabulary, not as the
product's information architecture. Tape, torn paper, pins, handwriting, and
paper texture can make memory-based compositions feel personal, but they should
be presets applied to image boundaries after layout.

The product remains differentiated from a notes app by keeping wallpaper
resolution, safe areas, pixel-accurate export, focal crops, multi-image layout,
and device-specific composition at the center. A future style system can offer:

- **Editorial**: clean gap, hairline, consistent radius, restrained shadow.
- **Cinematic**: edge-to-edge crops, feathered meeting edges, color continuity.
- **Memory board**: overlap, paper edge, tape accents, slight rotation.
- **Minimal grid**: equal gaps, strict alignment, no decorative transition.

## Transition hierarchy

1. **Blurred extension**: best when a single hero does not cover the canvas.
   Duplicate the hero behind itself, cover the canvas, blur it, reduce contrast,
   and add a subtle color wash. The editor currently implements the editable
   blurred duplicate, automatic cover scaling, and tonal softening.
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
- normalized crop rectangle and focal point for every image;
- boundary type, gap, corner radius, line width, and optional color;
- transition type, strength, and feather width;
- whether faces and negative space must be preserved.

The renderer remains responsible for validating coordinates and applying the
transition safely.
