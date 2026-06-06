"use client";

import { RATIO_PRESETS } from "@/lib/wallpaper/ratios";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { useEditorStore } from "@/store/editorStore";
import type { WallpaperRatioId } from "@/types/wallpaper";

export function Toolbar() {
  const ratioId = useEditorStore((state) => state.ratioId);
  const setRatio = useEditorStore((state) => state.setRatio);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const isCanvasReady = useEditorStore((state) => state.isCanvasReady);
  const exportStatus = useEditorStore((state) => state.exportStatus);
  const isAssetPanelOpen = useEditorStore((state) => state.isAssetPanelOpen);
  const isInspectorOpen = useEditorStore((state) => state.isInspectorOpen);
  const toggleAssetPanel = useEditorStore((state) => state.toggleAssetPanel);
  const toggleInspector = useEditorStore((state) => state.toggleInspector);
  const {
    deleteSelection,
    duplicateSelection,
    moveSelectionBackward,
    moveSelectionForward,
    exportPng,
  } = useEditorCommands();
  const hasSelection = Boolean(selectedObjectId);

  return (
    <header className="toolbar editor-glass">
      <div className="toolbar-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>Wallpaper Studio</span>
      </div>
      <div className="toolbar-actions">
        <div className="toolbar-command-group panel-toggle-group" aria-label="Workspace panels">
          <button
            className={`icon-button ${isAssetPanelOpen ? "is-active" : ""}`}
            aria-label="Toggle assets panel"
            title="Toggle assets panel"
            onClick={toggleAssetPanel}
          >
            ◧
          </button>
          <button
            className={`icon-button ${isInspectorOpen ? "is-active" : ""}`}
            aria-label="Toggle inspector"
            title="Toggle inspector"
            onClick={toggleInspector}
          >
            ◨
          </button>
        </div>
        <div className="toolbar-command-group" aria-label="Canvas commands">
          <button
            className="icon-button"
            disabled={!hasSelection}
            aria-label="Duplicate"
            title="Duplicate"
            onClick={() => void duplicateSelection()}
          >
            ⧉
          </button>
          <button
            className="icon-button"
            disabled={!hasSelection}
            aria-label="Move backward"
            title="Move backward"
            onClick={moveSelectionBackward}
          >
            ↓
          </button>
          <button
            className="icon-button"
            disabled={!hasSelection}
            aria-label="Move forward"
            title="Move forward"
            onClick={moveSelectionForward}
          >
            ↑
          </button>
          <button
            className="icon-button"
            disabled={!hasSelection}
            aria-label="Delete"
            title="Delete"
            onClick={deleteSelection}
          >
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
        <button
          className="toolbar-button"
          disabled={!isCanvasReady || exportStatus === "exporting"}
          title="Export at the selected wallpaper resolution"
          onClick={() => void exportPng()}
        >
          {exportStatus === "exporting" ? "Exporting…" : "Export PNG"}
        </button>
      </div>
    </header>
  );
}
