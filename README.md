# AI Wallpaper Studio

AI-assisted, editable photo wallpaper canvas built with Next.js, TypeScript,
Tailwind CSS, Fabric.js, and Zustand.

## Current scope

- App Router project skeleton
- Responsive editor workspace
- Wallpaper ratio presets
- Zustand editor state
- Fabric.js canvas initialization and preview scaling
- Liquid glass responsive interface
- JPG, PNG, and WebP asset uploads
- Canvas image movement, scaling, rotation, duplication, deletion, and layering
- Full-resolution PNG export
- Collapsible workspace panels and focus mode
- Keyboard editing shortcuts
- Composition intents and transition guidance for future AI layouts
- Editable blurred backdrop generation for mixed-ratio compositions
- Canonical Zod layout and project schemas
- Local image color analysis and deterministic color grouping
- Desktop and mobile triptych layout candidates
- Fabric layout apply/serialize round trips
- 50-step layout undo and redo
- IndexedDB asset and draft persistence
- Desktop and mobile wallpaper safe-area overlays
- Stateful snapping with per-axis locking and release hysteresis

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Delete` / `Backspace` | Delete selection |
| `Cmd/Ctrl + D` | Duplicate selection |
| Arrow keys | Nudge selection by 1 px |
| `Shift + Arrow keys` | Nudge selection by 10 px |
| `Cmd/Ctrl + [` / `]` | Move selection backward / forward |
| `Escape` | Clear selection |
| `Tab` on the canvas | Toggle focus mode |

See [wallpaper composition strategy](docs/wallpaper-composition.md) for the
ratio and image-transition rules intended for the future AI layout service.
The latest delivery status is recorded in the
[project progress report](docs/project-progress-report-2026-06-07.md).

AI generation, face/subject detection, irregular templates, moodboards, and a
multi-project workspace are intentionally deferred.

## Development

```bash
npm install
npm run dev
```
