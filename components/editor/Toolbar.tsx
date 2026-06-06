"use client";

import { RATIO_PRESETS } from "@/lib/wallpaper/ratios";
import { useEditorStore } from "@/store/editorStore";
import type { WallpaperRatioId } from "@/types/wallpaper";

export function Toolbar() {
  const ratioId = useEditorStore((state) => state.ratioId);
  const setRatio = useEditorStore((state) => state.setRatio);

  return (
    <header className="toolbar">
      <div className="toolbar-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>Wallpaper Studio</span>
      </div>
      <div className="toolbar-actions">
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
          Export
        </button>
      </div>
    </header>
  );
}
