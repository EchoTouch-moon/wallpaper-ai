import { AssetPanel } from "@/components/editor/AssetPanel";
import { CanvasStage } from "@/components/editor/CanvasStage";
import { EditorProvider } from "@/components/editor/EditorProvider";
import { PropertyPanel } from "@/components/editor/PropertyPanel";
import { Toolbar } from "@/components/editor/Toolbar";

export default function EditorPage() {
  return (
    <EditorProvider>
      <main className="editor-shell">
        <Toolbar />
        <AssetPanel />
        <section className="stage-region">
          <CanvasStage />
        </section>
        <PropertyPanel />
      </main>
    </EditorProvider>
  );
}
