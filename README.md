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

AI generation, persistence, history, and wallpaper safe-area tools are
intentionally deferred.

## Development

```bash
npm install
npm run dev
```
