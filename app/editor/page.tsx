import { EditorProvider } from "@/components/editor/EditorProvider";
import { CanvasFirstWorkspace as EditorWorkspace } from "@/components/editor/CanvasFirstWorkspace";

export default function EditorPage() {
  return (
    <EditorProvider>
      <EditorWorkspace />
    </EditorProvider>
  );
}
