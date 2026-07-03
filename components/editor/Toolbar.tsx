"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RATIO_PRESETS } from "@wallpaper/core/wallpaper";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { useEditorStore } from "@/store/editorStore";
import type { WallpaperRatioId } from "@wallpaper/core/types";

interface IconButtonProps {
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}

function IconButton({ active = false, disabled = false, children, label, onClick }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`toolbar-icon ${active ? "toolbar-icon-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function Toolbar() {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreWrapRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const ratioId = useEditorStore((state) => state.ratioId);
  const setRatio = useEditorStore((state) => state.setRatio);
  const selectedObjectId = useEditorStore((state) => state.selectedObjectId);
  const isCanvasReady = useEditorStore((state) => state.isCanvasReady);
  const exportStatus = useEditorStore((state) => state.exportStatus);
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
    redo,
    undo,
  } = useEditorCommands();
  const hasSelection = Boolean(selectedObjectId);
  const closeMore = (restoreFocus = false) => {
    setIsMoreOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => moreTriggerRef.current?.focus());
    }
  };

  useEffect(() => {
    if (!isMoreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!moreWrapRef.current?.contains(event.target as Node)) closeMore();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMore(true);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isMoreOpen]);

  return (
    <header className="canvas-toolbar">
      <div className="toolbar-brand" aria-label="AI 壁纸工作室">
        <span className="toolbar-mark" aria-hidden="true"><i /></span>
        <div><strong>AI 壁纸工作室</strong><span>{currentLayout ? "已应用方案" : "新建画布"}</span></div>
      </div>

      <label className="toolbar-ratio-control">
        <span>画幅</span>
        <select aria-label="画幅比例" value={ratioId} onChange={(event) => setRatio(event.target.value as WallpaperRatioId)}>
          {RATIO_PRESETS.map((ratio) => <option key={ratio.id} value={ratio.id}>{ratio.label}</option>)}
        </select>
      </label>

      <div className="toolbar-actions">
        <div className="toolbar-history" aria-label="历史记录">
          <IconButton disabled={!canUndo} label="撤销" onClick={undo}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 7 4 12l5 5M20 12H5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg></IconButton>
          <IconButton disabled={!canRedo} label="重做" onClick={redo}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 7 5 5-5 5M4 12h15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg></IconButton>
        </div>

        <div className="toolbar-more-wrap" ref={moreWrapRef}>
          <button aria-controls="editor-more-menu" aria-expanded={isMoreOpen} aria-haspopup="dialog" className="toolbar-more-trigger" onClick={() => setIsMoreOpen((open) => !open)} ref={moreTriggerRef} type="button">
            更多 <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg>
          </button>
          {isMoreOpen ? (
            <div aria-label="更多画布操作" className="toolbar-more-menu" id="editor-more-menu">
              <span className="toolbar-menu-label">画布视图</span>
              <button aria-pressed={showSafeAreas} onClick={() => { toggleSafeAreas(); closeMore(); }} type="button"><span>安全区域</span><small>{showSafeAreas ? "已显示" : "已隐藏"}</small></button>
              <button aria-pressed={enableSnapping} onClick={() => { toggleSnapping(); closeMore(); }} type="button"><span>对齐参考线</span><small>{enableSnapping ? "已开启" : "已关闭"}</small></button>
              {hasSelection ? <>
                <span className="toolbar-menu-label">选中对象</span>
                <button onClick={() => { void duplicateSelection(); closeMore(); }} type="button"><span>复制图层</span><kbd>⌘D</kbd></button>
                <button onClick={() => { moveSelectionForward(); closeMore(); }} type="button"><span>上移一层</span><kbd>⌘]</kbd></button>
                <button onClick={() => { moveSelectionBackward(); closeMore(); }} type="button"><span>下移一层</span><kbd>⌘[</kbd></button>
                <button className="toolbar-menu-danger" onClick={() => { deleteSelection(); closeMore(); }} type="button"><span>删除图层</span><kbd>⌫</kbd></button>
              </> : null}
            </div>
          ) : null}
        </div>

        <button aria-label="导出图片" className="toolbar-export" disabled={!isCanvasReady || exportStatus === "exporting"} onClick={exportPng} type="button">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v3a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg>
          <span>{exportStatus === "exporting" ? "导出中" : "导出"}</span>
        </button>
      </div>
    </header>
  );
}
