"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AssetPanel } from "@/components/editor/AssetPanel";
import { CanvasStage } from "@/components/editor/CanvasStage";
import { EditorDock, type EditorDockItem } from "@/components/editor/EditorDock";
import { PropertyPanel } from "@/components/editor/PropertyPanel";
import { TemplatePreviewBar } from "@/components/editor/TemplatePreviewBar";
import { Toolbar } from "@/components/editor/Toolbar";

type DrawerId = "assets" | "layouts" | "inspector";

function toolIcon(children: ReactNode) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>;
}

export function CanvasFirstWorkspace() {
  const [activeDrawer, setActiveDrawer] = useState<DrawerId | null>(null);
  const lastDrawer = useRef<DrawerId | null>(null);
  const closeDrawer = () => setActiveDrawer(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activeDrawer) {
        event.preventDefault();
        event.stopPropagation();
        closeDrawer();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeDrawer]);

  useEffect(() => {
    if (activeDrawer) {
      lastDrawer.current = activeDrawer;
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>("[data-editor-drawer] > div:not([hidden]) .drawer-close-control")?.focus();
      });
      return;
    }

    if (lastDrawer.current) {
      const label = lastDrawer.current === "assets" ? "素材" : lastDrawer.current === "layouts" ? "排版" : "检查器";
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`[data-editor-dock] button[aria-label="${label}"]`)?.focus();
      });
    }
  }, [activeDrawer]);

  const leftItems: EditorDockItem[] = [
    {
      id: "assets",
      label: "素材",
      controls: "editor-workspace-drawer",
      onSelect: () => selectDrawer("assets"),
      icon: toolIcon(<><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" /><path d="m5 17 4.2-4.2a1.4 1.4 0 0 1 2 0L14 15.6l1.7-1.7a1.4 1.4 0 0 1 2 0L20 16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /><circle cx="8" cy="9" r="1.2" fill="currentColor" /></>),
    },
    {
      id: "layouts",
      label: "排版",
      controls: "editor-workspace-drawer",
      onSelect: () => selectDrawer("layouts"),
      icon: toolIcon(<><rect x="4" y="4" width="16" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="4" y="12" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="14" y="12" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.6" /></>),
    },
  ];
  const rightItems: EditorDockItem[] = [{
    id: "inspector",
    label: "检查器",
    controls: "editor-workspace-drawer",
    onSelect: () => selectDrawer("inspector"),
    icon: toolIcon(<><path d="M5 5h14M5 12h14M5 19h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" /><circle cx="9" cy="5" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="11" cy="19" r="2" fill="currentColor" /></>),
  }];

  const selectDrawer = (drawer: DrawerId) =>
    setActiveDrawer((current) => (current === drawer ? null : drawer));

  return (
    <main className="canvas-first-editor">
      <Toolbar />
      <section
        aria-label="壁纸编辑工作区"
        className={`canvas-workspace ${activeDrawer ? `drawer-open-${activeDrawer === "inspector" ? "right" : "left"}` : ""}`}
      >
        <CanvasStage />
        <EditorDock
          activeId={activeDrawer === "inspector" ? null : activeDrawer}
          controls="editor-workspace-drawer"
          items={leftItems}
          label="内容工具"
          side="left"
        />
        <EditorDock
          activeId={activeDrawer === "inspector" ? "inspector" : null}
          controls="editor-workspace-drawer"
          items={rightItems}
          label="检查器工具"
          side="right"
        />
        <aside
          aria-hidden={!activeDrawer}
          aria-label={activeDrawer === "layouts" ? "智能排版" : activeDrawer === "assets" ? "素材库" : "画布检查器"}
          className={`workspace-drawer workspace-drawer-${activeDrawer === "inspector" ? "right" : "left"}`}
          data-editor-drawer="true"
          id="editor-workspace-drawer"
        >
          <div hidden={activeDrawer !== "assets"}><AssetPanel onClose={closeDrawer} /></div>
          <div hidden={activeDrawer !== "layouts"}><TemplatePreviewBar onClose={closeDrawer} /></div>
          <div hidden={activeDrawer !== "inspector"}><PropertyPanel onClose={closeDrawer} /></div>
        </aside>
      </section>
    </main>
  );
}
