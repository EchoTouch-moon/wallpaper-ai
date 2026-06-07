"use client";

import { useEditorCommands } from "@/components/editor/EditorProvider";
import { COMPOSITION_PRESETS } from "@/lib/wallpaper/compositionPresets";
import { useEditorStore } from "@/store/editorStore";
import type { CompositionIntent } from "@/types/layout";
import type { CropAspectId } from "@/types/canvas";

const CROP_OPTIONS: Array<{ id: CropAspectId; label: string }> = [
  { id: "free", label: "Choose crop ratio" },
  { id: "16:9", label: "Landscape · 16:9" },
  { id: "4:3", label: "Classic · 4:3" },
  { id: "1:1", label: "Square · 1:1" },
  { id: "3:4", label: "Portrait · 3:4" },
  { id: "9:16", label: "Story · 9:16" },
];

export function PropertyPanel() {
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const previewScale = useEditorStore((state) => state.previewScale);
  const objectCount = useEditorStore((state) => state.objectCount);
  const selectedObject = useEditorStore((state) => state.selectedObject);
  const exportStatus = useEditorStore((state) => state.exportStatus);
  const exportError = useEditorStore((state) => state.exportError);
  const compositionIntent = useEditorStore((state) => state.compositionIntent);
  const setCompositionIntent = useEditorStore((state) => state.setCompositionIntent);
  const hasBackdrop = useEditorStore((state) => state.hasBackdrop);
  const cropSession = useEditorStore((state) => state.cropSession);
  const {
    applyCropPreset,
    createBlurredBackdrop,
    finishCrop,
    removeBackdrop,
    resetCrop,
  } = useEditorCommands();
  const activeComposition =
    COMPOSITION_PRESETS.find((preset) => preset.id === compositionIntent) ??
    COMPOSITION_PRESETS[0];

  return (
    <aside className="side-panel right editor-glass">
      <div className="panel-heading">
        <h2>Inspector</h2>
        <span>Canvas</span>
      </div>
      <section className="panel-section">
        <span className="panel-label">Document</span>
        <div className="property-row">
          <span>Width</span>
          <span className="property-value">{canvasSize.width}px</span>
        </div>
        <div className="property-row">
          <span>Height</span>
          <span className="property-value">{canvasSize.height}px</span>
        </div>
        <div className="property-row">
          <span>Preview</span>
          <span className="property-value">{Math.round(previewScale * 100)}%</span>
        </div>
      </section>
      <section className="panel-section">
        <span className="panel-label">Crop & framing</span>
        <select
          className="property-select"
          value={selectedObject?.cropAspect ?? "free"}
          disabled={!selectedObject?.assetId || selectedObject.role === "background"}
          onChange={(event) => {
            const aspect = event.target.value as CropAspectId;
            if (aspect !== "free") {
              applyCropPreset(aspect);
            }
          }}
          aria-label="Crop ratio"
        >
          {CROP_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="crop-actions">
          {cropSession && cropSession.objectId === selectedObject?.id ? (
            <button type="button" onClick={finishCrop}>
              Done cropping
            </button>
          ) : selectedObject?.cropAspect ? (
            <button
              type="button"
              onClick={() => {
                if (selectedObject.cropAspect) {
                  applyCropPreset(selectedObject.cropAspect);
                }
              }}
            >
              Reframe crop
            </button>
          ) : null}
          <button
            type="button"
            className="secondary"
            disabled={!selectedObject?.isCropped}
            onClick={resetCrop}
          >
            Reset
          </button>
        </div>
        <p className="transition-help">
          Apply a frame, then drag the photo inside the fixed crop window to choose
          what remains visible.
        </p>
      </section>
      <section className="panel-section">
        <span className="panel-label">Selection</span>
        <div className="property-row">
          <span>Objects</span>
          <span className="property-value">{objectCount}</span>
        </div>
        {selectedObject ? (
          <>
            <div className="property-grid">
              <div>
                <span>X</span>
                <strong>{selectedObject.x}</strong>
              </div>
              <div>
                <span>Y</span>
                <strong>{selectedObject.y}</strong>
              </div>
              <div>
                <span>W</span>
                <strong>{selectedObject.width}</strong>
              </div>
              <div>
                <span>H</span>
                <strong>{selectedObject.height}</strong>
              </div>
            </div>
            <div className="property-row">
              <span>Rotation</span>
              <span className="property-value">{selectedObject.rotation}°</span>
            </div>
            <div className="property-row">
              <span>Opacity</span>
              <span className="property-value">{selectedObject.opacity}%</span>
            </div>
          </>
        ) : (
          <p className="empty-selection">Select an image on the canvas to inspect it.</p>
        )}
      </section>
      <section className="panel-section">
        <span className="panel-label">Composition direction</span>
        <select
          className="property-select"
          value={compositionIntent}
          onChange={(event) =>
            setCompositionIntent(event.target.value as CompositionIntent)
          }
          aria-label="Composition direction"
        >
          {COMPOSITION_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <p className="composition-note">{activeComposition.description}</p>
        <p className="composition-best-for">
          <strong>Best for</strong>
          {activeComposition.bestFor}
        </p>
        <div className="transition-actions">
          <button
            type="button"
            disabled={!selectedObject?.assetId || selectedObject.role === "background"}
            onClick={() => void createBlurredBackdrop()}
          >
            {hasBackdrop ? "Replace soft backdrop" : "Create soft backdrop"}
          </button>
          {hasBackdrop ? (
            <button type="button" className="secondary" onClick={removeBackdrop}>
              Remove
            </button>
          ) : null}
        </div>
        <p className="transition-help">
          Extends the selected photo behind the composition with blur and tonal
          softening. Best for portrait or square photos on wide wallpapers.
        </p>
      </section>
      <section className="panel-section">
        <span className="panel-label">Output</span>
        <div className="property-row">
          <span>Format</span>
          <span className="property-value">PNG</span>
        </div>
        <div className="property-row">
          <span>Resolution</span>
          <span className="property-value">
            {canvasSize.width} × {canvasSize.height}
          </span>
        </div>
        {exportStatus === "success" ? (
          <p className="export-message success">Last export completed.</p>
        ) : null}
        {exportStatus === "error" ? (
          <p className="export-message error">{exportError ?? "Export failed."}</p>
        ) : null}
      </section>
    </aside>
  );
}
