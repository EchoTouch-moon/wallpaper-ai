import { EditorProvider } from "@/components/editor/EditorProvider";
import { EditorWorkspace } from "@/components/editor/EditorWorkspace";

export default function EditorPage() {
  return (
    <EditorProvider>
      <EditorWorkspace />
    </EditorProvider>
  );
}
