"use client";

import { useEditorCommands } from "@/components/editor/EditorProvider";
import { COMPOSITION_PRESETS } from "@wallpaper/core/wallpaper";
import { useEditorStore } from "@/store/editorStore";
import type { CompositionIntent } from "@wallpaper/core/types";
import type { CropAspectId } from "@wallpaper/core/types";

const CROP_OPTIONS: Array<{ id: CropAspectId; label: string }> = [
  { id: "free", label: "自由裁剪" },
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
];

function rgbToHex(color: string) {
  if (!color) return "#ffffff";
  if (color.startsWith("#")) return color;
  const match = color.match(/\d+/g);
  if (!match || match.length < 3) return "#ffffff";
  const r = parseInt(match[0], 10).toString(16).padStart(2, "0");
  const g = parseInt(match[1], 10).toString(16).padStart(2, "0");
  const b = parseInt(match[2], 10).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function SectionTitle({ title }: { title: string }) {
  return <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-[11px] mb-2">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-gray-900">{value}</span>
    </div>
  );
}

interface PropertyPanelProps {
  onClose?: () => void;
}

export function PropertyPanel({ onClose }: PropertyPanelProps) {
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const previewScale = useEditorStore((state) => state.previewScale);
  const objectCount = useEditorStore((state) => state.objectCount);
  const selectedObject = useEditorStore((state) => state.selectedObject);
  const compositionIntent = useEditorStore((state) => state.compositionIntent);
  const setCompositionIntent = useEditorStore((state) => state.setCompositionIntent);
  const hasBackdrop = useEditorStore((state) => state.hasBackdrop);
  const cropSession = useEditorStore((state) => state.cropSession);
  const currentLayout = useEditorStore((state) => state.currentLayout);
  
  const {
    applyCropPreset,
    createBlurredBackdrop,
    finishCrop,
    removeBackdrop,
    resetCrop,
    updateSelectedObject,
    updateCanvasBackground,
  } = useEditorCommands();

  const activeComposition =
    COMPOSITION_PRESETS.find((preset) => preset.id === compositionIntent) ??
    COMPOSITION_PRESETS[0];

  const canvasBackgroundColor = currentLayout?.canvas.backgroundColor ?? "#ffffff";

  return (
    <aside className="flex flex-col w-full h-full bg-white overflow-y-auto p-5 shrink-0 border-l border-gray-100">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold tracking-tight text-gray-900">参数面板</h2>
        <button 
          onClick={onClose}
          className="drawer-close-control"
          aria-label="关闭检查器"
          title="关闭检查器"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {/* Document Information & Background */}
        <section>
          <SectionTitle title="文档信息" />
          <Row label="画布尺寸" value={`${canvasSize.width} × ${canvasSize.height}`} />
          <Row label="缩放比例" value={`${Math.round(previewScale * 100)}%`} />
          <Row 
            label="背景颜色" 
            value={
              <div className="flex items-center gap-1.5">
                <input 
                  type="color" 
                  className="w-5 h-5 border border-gray-200 rounded cursor-pointer p-0 bg-transparent disabled:opacity-30 disabled:cursor-not-allowed"
                  value={rgbToHex(canvasBackgroundColor)} 
                  disabled={!currentLayout}
                  onChange={(e) => updateCanvasBackground(e.target.value)}
                />
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">{canvasBackgroundColor}</span>
              </div>
            }
          />
        </section>

        <div className="h-px bg-gray-100" />

        {/* Selected Object Geometry & Opacity */}
        <section>
          <SectionTitle title="选区状态" />
          <Row label="对象数量" value={objectCount} />
          {selectedObject ? (
            <div className="mt-2 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-1.5">
                {['x', 'y', 'width', 'height'].map(prop => (
                  <div key={prop} className="flex justify-between px-2 py-1.5 bg-gray-50 border border-gray-100 rounded-md">
                    <span className="text-[9px] text-gray-400 uppercase tracking-widest">{prop.charAt(0)}</span>
                    <span className="text-[10px] font-mono font-medium text-gray-900 truncate">
                      {Math.round(selectedObject[prop as keyof typeof selectedObject] as number)}
                    </span>
                  </div>
                ))}
              </div>
              <Row label="旋转角度" value={`${Math.round(selectedObject.rotation)}°`} />
              
              {/* Opacity Slider */}
              <div className="mt-1">
                <div className="flex justify-between items-center text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                  <span>不透明度</span>
                  <span className="font-mono">{selectedObject.opacity}%</span>
                </div>
                <input 
                  type="range"
                  min="0"
                  max="100"
                  className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-black"
                  value={selectedObject.opacity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    updateSelectedObject({ opacity: val / 100 }, false);
                  }}
                  onPointerUp={(e) => {
                    const val = parseInt((e.target as HTMLInputElement).value, 10);
                    updateSelectedObject({ opacity: val / 100 }, true);
                  }}
                  onKeyUp={(e) => {
                    const val = parseInt((e.target as HTMLInputElement).value, 10);
                    updateSelectedObject({ opacity: val / 100 }, true);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="mt-2 p-2 bg-gray-50 border border-gray-100 rounded-md text-[10px] text-gray-400 text-center">
              未选中对象
            </div>
          )}
        </section>

        <div className="h-px bg-gray-100" />

        {/* Selected Object Design Styles */}
        {selectedObject && (
          <>
            <section>
              <SectionTitle title="图层样式" />
              
              {/* Rounded Corner Radius */}
              <div>
                <div className="flex justify-between items-center text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                  <span>圆角半径</span>
                  <span className="font-mono">{selectedObject.style?.radius ?? 0}px</span>
                </div>
                <input 
                  type="range"
                  min="0"
                  max="100"
                  className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-black"
                  value={selectedObject.style?.radius ?? 0}
                  onChange={(e) => {
                    const radiusVal = parseInt(e.target.value, 10);
                    updateSelectedObject({ style: { radius: radiusVal } }, false);
                  }}
                  onPointerUp={(e) => {
                    const radiusVal = parseInt((e.target as HTMLInputElement).value, 10);
                    updateSelectedObject({ style: { radius: radiusVal } }, true);
                  }}
                  onKeyUp={(e) => {
                    const radiusVal = parseInt((e.target as HTMLInputElement).value, 10);
                    updateSelectedObject({ style: { radius: radiusVal } }, true);
                  }}
                />
              </div>

              {/* Border Properties */}
              <div className="mt-4 flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex justify-between items-center text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                    <span>边框宽度</span>
                    <span className="font-mono">{selectedObject.style?.border?.width ?? 0}px</span>
                  </div>
                  <input 
                    type="range"
                    min="0"
                    max="16"
                    className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-black"
                    value={selectedObject.style?.border?.width ?? 0}
                    onChange={(e) => {
                      const widthVal = parseInt(e.target.value, 10);
                      updateSelectedObject({
                        style: {
                          border: {
                            width: widthVal,
                            color: selectedObject.style?.border?.color ?? "rgba(255,255,255,1)",
                          },
                        },
                      }, false);
                    }}
                    onPointerUp={(e) => {
                      const widthVal = parseInt((e.target as HTMLInputElement).value, 10);
                      updateSelectedObject({
                        style: {
                          border: {
                            width: widthVal,
                            color: selectedObject.style?.border?.color ?? "rgba(255,255,255,1)",
                          },
                        },
                      }, true);
                    }}
                    onKeyUp={(e) => {
                      const widthVal = parseInt((e.target as HTMLInputElement).value, 10);
                      updateSelectedObject({
                        style: {
                          border: {
                            width: widthVal,
                            color: selectedObject.style?.border?.color ?? "rgba(255,255,255,1)",
                          },
                        },
                      }, true);
                    }}
                  />
                </div>
                <div className="flex flex-col items-center shrink-0">
                  <span className="text-[9px] text-gray-400 uppercase mb-1">边框颜色</span>
                  <input 
                    type="color"
                    className="w-5 h-5 border border-gray-200 rounded cursor-pointer p-0 bg-transparent"
                    value={rgbToHex(selectedObject.style?.border?.color ?? "#ffffff")}
                    onChange={(e) => {
                      const colorVal = e.target.value;
                      updateSelectedObject({
                        style: {
                          border: {
                            width: selectedObject.style?.border?.width ?? 1,
                            color: colorVal,
                          },
                        },
                      });
                    }}
                  />
                </div>
              </div>

              {/* Shadow Select */}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[10px] text-gray-400 uppercase tracking-wider">投影效果</span>
                <select
                  className="px-2 py-1 text-xs border border-gray-200 rounded-lg bg-gray-50 text-gray-900 focus:outline-none focus:border-black cursor-pointer"
                  value={selectedObject.style?.shadow ?? "none"}
                  onChange={(e) => {
                    const shadowVal = e.target.value as "none" | "soft" | "strong";
                    updateSelectedObject({ style: { shadow: shadowVal } });
                  }}
                >
                  <option value="none">无阴影</option>
                  <option value="soft">柔和阴影</option>
                  <option value="strong">强阴影</option>
                </select>
              </div>
            </section>
            <div className="h-px bg-gray-100" />
          </>
        )}

        {/* Crop and Fitting */}
        <section>
          <SectionTitle title="裁剪定位" />
          <select
            className="w-full mb-2 px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 hover:bg-white text-gray-900 focus:outline-none focus:border-black disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 transition-colors cursor-pointer"
            value={selectedObject?.cropAspect ?? "free"}
            disabled={!selectedObject?.assetId || selectedObject.role === "background"}
            onChange={(event) => {
              const aspect = event.target.value as CropAspectId;
              if (aspect !== "free") applyCropPreset(aspect);
            }}
          >
            {CROP_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>

          <div className="flex gap-2">
            {cropSession && cropSession.objectId === selectedObject?.id ? (
              <button className="btn-primary flex-1 py-1.5 text-[10px] font-semibold rounded-md shadow-sm transition-colors cursor-pointer" onClick={finishCrop}>完成裁剪</button>
            ) : selectedObject?.cropAspect ? (
              <button
                className="btn-primary flex-1 py-1.5 text-[10px] font-semibold rounded-md shadow-sm transition-colors cursor-pointer"
                onClick={() => selectedObject.cropAspect && applyCropPreset(selectedObject.cropAspect)}
              >
                调整裁剪
              </button>
            ) : null}
            <button
              className="btn-secondary px-3 py-1.5 text-[10px] font-semibold rounded-md transition-colors cursor-pointer"
              disabled={!selectedObject?.isCropped}
              onClick={resetCrop}
            >
              重置
            </button>
          </div>
        </section>

        <div className="h-px bg-gray-100" />

        {/* Backdrop & Composition */}
        <section>
          <SectionTitle title="色彩智能布局" />
          <select
            className="w-full mb-2 px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 hover:bg-white text-gray-900 focus:outline-none focus:border-black transition-colors cursor-pointer"
            value={compositionIntent}
            onChange={(event) => setCompositionIntent(event.target.value as CompositionIntent)}
          >
            {COMPOSITION_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-500 leading-relaxed mb-3">{activeComposition.description}</p>
          
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1 py-1.5 text-[10px] font-semibold rounded-md shadow-sm transition-colors cursor-pointer"
              disabled={!selectedObject?.assetId || selectedObject.role === "background"}
              onClick={() => void createBlurredBackdrop()}
            >
              {hasBackdrop ? "替换背景" : "生成模糊背景"}
            </button>
            {hasBackdrop ? (
              <button className="px-3 py-1.5 bg-white text-red-600 border border-red-200 text-[10px] font-semibold rounded-md hover:bg-red-50 transition-colors cursor-pointer" onClick={removeBackdrop}>
                移除背景
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </aside>
  );
}
