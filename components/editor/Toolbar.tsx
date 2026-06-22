"use client";

import { RATIO_PRESETS } from "@/lib/wallpaper/ratios";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { useEditorStore } from "@/store/editorStore";
import type { WallpaperRatioId } from "@/types/wallpaper";

interface IconButtonProps {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
}

function IconButton({ active, disabled, onClick, children, title }: IconButtonProps) {
  return (
    <button
      className={`w-8 h-8 flex items-center justify-center rounded-md transition-all duration-150 text-sm
        ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
        ${active ? "icon-btn-active shadow-sm" : "icon-btn-inactive"}
      `}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

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
  const canUndo = useEditorStore((state) => state.historyPast.length > 0);
  const canRedo = useEditorStore((state) => state.historyFuture.length > 0);
  const showSafeAreas = useEditorStore((state) => state.showSafeAreas);
  const toggleSafeAreas = useEditorStore((state) => state.toggleSafeAreas);
  const enableSnapping = useEditorStore((state) => state.enableSnapping);
  const toggleSnapping = useEditorStore((state) => state.toggleSnapping);
  const currentLayout = useEditorStore((state) => state.currentLayout);
  const {
    deleteSelection,
    duplicateSelection,
    moveSelectionBackward,
    moveSelectionForward,
    exportPng,
    undo,
    redo,
  } = useEditorCommands();
  const hasSelection = Boolean(selectedObjectId);

  return (
    <header className="editor-toolbar w-full h-14 flex items-center justify-between px-6 z-20 shrink-0 select-none">
      {/* Left side: Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="editor-mark w-6 h-6 rounded flex items-center justify-center">
          <div className="w-2.5 h-2.5 rounded-sm" />
        </div>
        <span className="editor-title font-semibold text-sm tracking-tight">AI 壁纸工作室</span>

        {currentLayout && (
          <span className="editor-layout-status ml-2 px-2.5 py-1 text-[10px] font-medium rounded-full flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" />
            排版模式：拖动照片可交换位置
          </span>
        )}
      </div>

      {/* Middle side: Main Canvas / Edit Operations */}
      <div className="flex items-center gap-2">
        <div className="editor-command-group flex items-center gap-0.5 p-0.5 rounded-lg">
          <IconButton disabled={!canUndo} onClick={undo} title="撤销">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" /></svg>
          </IconButton>
          <IconButton disabled={!canRedo} onClick={redo} title="重做">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 005 8v8a1 1 0 001.6.8l5.334-4z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.334-4z" /></svg>
          </IconButton>
        </div>

        <div className="editor-divider w-px h-5 mx-1" />

        <div className="editor-command-group flex items-center gap-0.5 p-0.5 rounded-lg">
          <IconButton disabled={!hasSelection} onClick={duplicateSelection} title="复制">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
          </IconButton>
          <IconButton disabled={!hasSelection} onClick={moveSelectionBackward} title="下移一层">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </IconButton>
          <IconButton disabled={!hasSelection} onClick={moveSelectionForward} title="上移一层">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
          </IconButton>
          <IconButton disabled={!hasSelection} onClick={deleteSelection} title="删除">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </IconButton>
        </div>

        <div className="editor-divider w-px h-5 mx-1" />

        <label className="editor-ratio-control flex items-center gap-2 h-9 px-3 rounded-lg text-xs font-medium transition-colors cursor-pointer">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider font-mono">比例</span>
          <select
            className="bg-transparent border-none outline-none text-gray-900 cursor-pointer font-semibold text-xs pr-1"
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
      </div>

      {/* Right side: View Toggles & Export */}
      <div className="flex items-center gap-3">
        <div className="editor-command-group flex items-center gap-0.5 p-0.5 rounded-lg">
          <IconButton active={isAssetPanelOpen} onClick={toggleAssetPanel} title="切换素材库">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" /></svg>
          </IconButton>
          <IconButton active={isInspectorOpen} onClick={toggleInspector} title="切换参数面板">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
          </IconButton>
        </div>

        <IconButton active={showSafeAreas} onClick={toggleSafeAreas} title="显示安全区">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        </IconButton>

        <IconButton active={enableSnapping} onClick={toggleSnapping} title="对齐参考线">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16M12 4v16" />
          </svg>
        </IconButton>

        <button
          className="editor-export h-9 px-5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-150 flex items-center gap-1.5 cursor-pointer"
          disabled={!isCanvasReady || exportStatus === "exporting"}
          onClick={exportPng}
        >
          {exportStatus === "exporting" ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>正在导出…</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              <span>导出图片</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
