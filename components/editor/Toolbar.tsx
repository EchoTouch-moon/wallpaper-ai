"use client";

import { RATIO_PRESETS } from "@/lib/wallpaper/ratios";
import { useEditorStore } from "@/store/editorStore";
import type { WallpaperRatioId } from "@/types/wallpaper";

export function Toolbar() {
  const ratioId = useEditorStore((state) => state.ratioId);
  const setRatio = useEditorStore((state) => state.setRatio);

  return (
    <header className="toolbar editor-glass">
      <div className="toolbar-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>Wallpaper Studio</span>
      </div>
      <div className="toolbar-actions">
        <div className="toolbar-command-group" aria-label="Canvas commands">
          <button className="icon-button" disabled aria-label="Duplicate" title="Duplicate">
            ⧉
          </button>
          <button className="icon-button" disabled aria-label="Move backward" title="Move backward">
            ↓
          </button>
          <button className="icon-button" disabled aria-label="Move forward" title="Move forward">
            ↑
          </button>
          <button className="icon-button" disabled aria-label="Delete" title="Delete">
            ×
          </button>
        </div>
        <label className="toolbar-control">
          <span>Ratio</span>
          <select
            aria-label="Wallpaper ratio"
            value={ratioId}
            onChange={(event) => setRatio(event.target.value as WallpaperRatioId)}
          >
            {RATIO_PRESETS.map((ratio) => (
              <option key={ratio.id} value={ratio.id}>
                {ratio.label}
              </option>
            ))}
          </select>
        </label>
        <button className="toolbar-button" disabled title="Export will be added in the next phase">
          Export PNG
        </button>
      </div>
    </header>
  );
}
