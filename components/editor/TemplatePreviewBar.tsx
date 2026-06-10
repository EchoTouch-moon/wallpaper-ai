"use client";

import { useEditorCommands } from "@/components/editor/EditorProvider";
import { generateTriptychCandidates } from "@/lib/layout/planTriptych";
import { useEditorStore } from "@/store/editorStore";

export function TemplatePreviewBar() {
  const assets = useEditorStore((state) => state.assets);
  const candidates = useEditorStore((state) => state.candidates);
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const ratioId = useEditorStore((state) => state.ratioId);
  const setCandidates = useEditorStore((state) => state.setCandidates);
  const setNotice = useEditorStore((state) => state.setNotice);
  const toggleAssetPanel = useEditorStore((state) => state.toggleAssetPanel);
  const { applyLayout } = useEditorCommands();
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  const generate = () => {
    if (assets.length < 3) {
      return;
    }
    try {
      const nextCandidates = generateTriptychCandidates(
        assets.map((asset) => asset.analysis),
        canvasSize,
        ratioId,
      );
      setCandidates(nextCandidates);
      setNotice("已生成三组基于色彩感知的三分屏布局");
    } catch {
      setNotice("无法生成三分屏布局模板");
    }
  };

  return (
    <aside className="flex flex-col w-full h-full bg-white overflow-y-auto p-5 shrink-0 border-r border-gray-100 select-none">
      <div className="flex items-center justify-between mb-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">智能排版</h2>
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider font-mono">
            {candidates.length > 0
              ? "选择排版方向"
              : `照片已就绪: ${assets.length}/3`}
          </span>
        </div>
        <button 
          onClick={toggleAssetPanel}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-900 transition-colors cursor-pointer"
          title="关闭面板"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <button 
        className="btn-primary w-full py-2 text-xs font-semibold rounded-lg transition-colors mb-5 shadow-sm shrink-0"
        type="button" 
        disabled={assets.length < 3} 
        onClick={generate}
      >
        生成智能排版模板
      </button>
      
      {candidates.length > 0 ? (
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          {candidates.map((candidate) => (
            <button
              type="button"
              className="flex flex-col border border-gray-200 rounded-xl p-3 bg-gray-50 hover:bg-white hover:border-gray-950 transition-all cursor-pointer w-full text-left group shadow-sm hover:shadow"
              key={candidate.id}
              onClick={() => void applyLayout(candidate.layout)}
              title={candidate.reason}
            >
              {/* Preview Box */}
              <div
                className="relative w-full aspect-[4/3] overflow-hidden rounded-lg bg-white border border-gray-200 mb-3 shadow-sm"
                style={{
                  backgroundColor: candidate.layout.canvas.backgroundColor,
                }}
              >
                {candidate.layout.items.map((item) => {
                  const asset = assetsById.get(item.assetId);
                  return asset ? (
                    <i
                      key={item.id}
                      className="absolute block bg-cover bg-center transition-transform duration-300 group-hover:scale-102"
                      style={{
                        left: `${(item.x / candidate.layout.canvas.width) * 100}%`,
                        top: `${(item.y / candidate.layout.canvas.height) * 100}%`,
                        width: `${(item.width / candidate.layout.canvas.width) * 100}%`,
                        height: `${(item.height / candidate.layout.canvas.height) * 100}%`,
                        borderRadius: item.style?.radius
                          ? `${Math.min(item.style.radius / 4, 8)}px`
                          : 0,
                        backgroundImage: `url("${asset.thumbnailUrl}")`,
                      }}
                    />
                  ) : null;
                })}
              </div>

              {/* Text Info */}
              <div className="flex flex-col">
                <strong className="text-xs text-gray-900 font-semibold mb-0.5">{candidate.label}</strong>
                <small className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">{Math.round(candidate.harmonyScore * 100)}% 和谐度</small>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
          <svg className="w-8 h-8 text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
          <p className="text-xs text-gray-400 font-medium">请至少上传 3 张图片以生成排版布局</p>
        </div>
      )}
    </aside>
  );
}
