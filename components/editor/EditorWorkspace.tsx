"use client";

import { AssetPanel } from "@/components/editor/AssetPanel";
import { CanvasStage } from "@/components/editor/CanvasStage";
import { PropertyPanel } from "@/components/editor/PropertyPanel";
import { Toolbar } from "@/components/editor/Toolbar";
import { TemplatePreviewBar } from "@/components/editor/TemplatePreviewBar";
import { useEditorStore } from "@/store/editorStore";

export function EditorWorkspace() {
  const isAssetPanelOpen = useEditorStore((state) => state.isAssetPanelOpen);
  const isInspectorOpen = useEditorStore((state) => state.isInspectorOpen);

  const shellClasses = [
    "editor-shell",
    isAssetPanelOpen ? "" : "asset-panel-closed",
    isInspectorOpen ? "" : "inspector-closed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClasses}>
      <Toolbar />
      {isAssetPanelOpen ? <AssetPanel /> : null}
      <section className="stage-region">
        <CanvasStage />
        <TemplatePreviewBar />
      </section>
      {isInspectorOpen ? <PropertyPanel /> : null}
    </main>
  );
}
