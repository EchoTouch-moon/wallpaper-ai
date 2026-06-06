"use client";

import { useEditorStore } from "@/store/editorStore";

export function PropertyPanel() {
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const previewScale = useEditorStore((state) => state.previewScale);

  return (
    <aside className="side-panel right">
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
          <span className="property-value">0</span>
        </div>
      </section>
    </aside>
  );
}
