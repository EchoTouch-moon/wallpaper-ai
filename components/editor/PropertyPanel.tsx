"use client";

import { useEditorStore } from "@/store/editorStore";

export function PropertyPanel() {
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const previewScale = useEditorStore((state) => state.previewScale);
  const objectCount = useEditorStore((state) => state.objectCount);
  const selectedObject = useEditorStore((state) => state.selectedObject);
  const exportStatus = useEditorStore((state) => state.exportStatus);
  const exportError = useEditorStore((state) => state.exportError);

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
