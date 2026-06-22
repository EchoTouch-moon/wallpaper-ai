"use client";

import { useState } from "react";
import { AssetPanel } from "@/components/editor/AssetPanel";
import { CanvasStage } from "@/components/editor/CanvasStage";
import { PropertyPanel } from "@/components/editor/PropertyPanel";
import { Toolbar } from "@/components/editor/Toolbar";
import { TemplatePreviewBar } from "@/components/editor/TemplatePreviewBar";
import { useEditorStore } from "@/store/editorStore";

export function EditorWorkspace() {
  const isAssetPanelOpen = useEditorStore((state) => state.isAssetPanelOpen);
  const isInspectorOpen = useEditorStore((state) => state.isInspectorOpen);
  const toggleAssetPanel = useEditorStore((state) => state.toggleAssetPanel);
  const toggleInspector = useEditorStore((state) => state.toggleInspector);

  const [leftTab, setLeftTab] = useState<"assets" | "layouts">("assets");

  const handleLeftTabClick = (tab: "assets" | "layouts") => {
    if (isAssetPanelOpen) {
      if (leftTab === tab) {
        toggleAssetPanel();
      } else {
        setLeftTab(tab);
      }
    } else {
      setLeftTab(tab);
      toggleAssetPanel();
    }
  };

  return (
    <main className="minimal-editor flex flex-col h-screen w-screen overflow-hidden select-none">
      {/* Top Header / Toolbar */}
      <Toolbar />

      {/* Main Workspace Area (Sidebars + Canvas) */}
      <div className="editor-workspace flex flex-1 flex-row overflow-hidden relative w-full h-full">
        
        {/* Left Side Navigation & Asset/Layout Panel Drawer */}
        <div className="flex h-full shrink-0 z-10">
          
          {/* Canva-style Vertical Navigation Tab Bar */}
          <nav className="editor-rail w-16 h-full flex flex-col items-center py-4 gap-6 shrink-0">
            {/* Assets Tab Button */}
            <button
              onClick={() => handleLeftTabClick("assets")}
              className={`w-12 h-12 flex flex-col items-center justify-center rounded-lg transition-all duration-150 cursor-pointer
                ${isAssetPanelOpen && leftTab === "assets"
                  ? "bg-white text-black border border-gray-200 shadow-sm" 
                  : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"
                }
              `}
              title="素材"
            >
              <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-[9px] font-medium">素材</span>
            </button>

            {/* Layouts Tab Button */}
            <button
              onClick={() => handleLeftTabClick("layouts")}
              className={`w-12 h-12 flex flex-col items-center justify-center rounded-lg transition-all duration-150 cursor-pointer
                ${isAssetPanelOpen && leftTab === "layouts"
                  ? "bg-white text-black border border-gray-200 shadow-sm" 
                  : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"
                }
              `}
              title="排版"
            >
              <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <span className="text-[9px] font-medium">排版</span>
            </button>

            {/* Inspector Tab Button */}
            <button
              onClick={toggleInspector}
              className={`w-12 h-12 flex flex-col items-center justify-center rounded-lg transition-all duration-150 cursor-pointer
                ${isInspectorOpen 
                  ? "bg-white text-black border border-gray-200 shadow-sm" 
                  : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"
                }
              `}
              title="参数"
            >
              <svg className="w-5 h-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              <span className="text-[9px] font-medium">参数</span>
            </button>
          </nav>

          {/* Left Panel Content Drawer */}
          {isAssetPanelOpen && (
            <div className="editor-sidecar editor-sidecar-left w-[320px] h-full flex flex-col shrink-0 animate-in slide-in-from-left duration-200">
              {leftTab === "assets" ? <AssetPanel /> : <TemplatePreviewBar />}
            </div>
          )}
        </div>

        {/* Center Canvas Area */}
        <div className="editor-stage flex-1 flex flex-col relative h-full overflow-hidden">
          {/* Canvas Component */}
          <div className="absolute inset-0">
            <CanvasStage />
          </div>
        </div>

        {/* Right Sidebar Drawer */}
        {isInspectorOpen && (
          <div className="editor-sidecar editor-sidecar-right w-[280px] h-full flex flex-col shrink-0 z-10 animate-in slide-in-from-right duration-200">
            <PropertyPanel />
          </div>
        )}

      </div>
    </main>
  );
}
