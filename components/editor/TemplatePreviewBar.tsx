"use client";

import { useState } from "react";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { generateLayouts } from "@/lib/layout-generation/generateLayouts";
import { useEditorStore } from "@/store/editorStore";
import type {
  GenerateLayoutRequest,
  GenerateLayoutResponse,
} from "@/types/generateLayout";
import type { LayoutCandidate } from "@/types/layout";

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  triptych: "三联屏",
  "layered-moodboard": "主视觉",
  "portrait-triptych": "人像优先",
  "irregular-collage": "多图拼贴",
};

const INTENT_LABELS: Record<string, string> = {
  "single-hero": "单主图",
  "hero-with-support": "主辅图",
  "balanced-collage": "均衡拼贴",
  "story-strip": "叙事排列",
};

function getStrategyScore(candidate: LayoutCandidate) {
  const note = candidate.layout.notes.find((item) =>
    item.startsWith("Mock AI strategy:"),
  );
  const match = note?.match(/score (\d+) \/ color (\d+) \/ fit (\d+)/);

  if (!match) {
    return null;
  }

  return {
    total: match[1],
    color: match[2],
    fit: match[3],
  };
}

function getRecommendationSummary(candidate: LayoutCandidate) {
  const templateType = candidate.layout.template?.type ?? "";

  if (templateType === "portrait-triptych") {
    return "检测到人像或主体信号，优先保留人物画面重心。";
  }

  if (templateType === "irregular-collage") {
    return "素材数量更适合多图拼贴，增加画面层次和变化。";
  }

  if (templateType === "layered-moodboard") {
    return "优先突出高质量主图，并用辅助图补充氛围。";
  }

  if (templateType === "triptych") {
    return "图片色彩关系更统一，适合稳定的三联屏布局。";
  }

  return candidate.reason;
}

export function TemplatePreviewBar() {
  const [isGenerating, setIsGenerating] = useState(false);
  const assets = useEditorStore((state) => state.assets);
  const candidates = useEditorStore((state) => state.candidates);
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const ratioId = useEditorStore((state) => state.ratioId);
  const compositionIntent = useEditorStore((state) => state.compositionIntent);
  const setCandidates = useEditorStore((state) => state.setCandidates);
  const setNotice = useEditorStore((state) => state.setNotice);
  const toggleAssetPanel = useEditorStore((state) => state.toggleAssetPanel);
  const { applyLayout } = useEditorCommands();
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  const generate = async () => {
    if (assets.length < 3 || isGenerating) {
      return;
    }
    const request: GenerateLayoutRequest = {
      canvas: {
        width: canvasSize.width,
        height: canvasSize.height,
        ratioId,
      },
      intent: {
        mode: "mock-ai",
        style: "auto",
        compositionIntent,
        count: 3,
      },
      assets: assets.map((asset) => asset.analysis),
      options: {
        candidateCount: 3,
        allowFallback: true,
        strictValidation: true,
      },
    };

    setIsGenerating(true);

    try {
      try {
        const response = await fetch("/api/generate-layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          throw new Error("Layout API request failed");
        }

        const result = (await response.json()) as GenerateLayoutResponse;

        if (result.candidates.length === 0) {
          throw new Error("Layout API returned no candidates");
        }

        setCandidates(result.candidates);
        setNotice(result.warnings?.[0] ?? "已生成智能排版候选");
        return;
      } catch {
        const fallback = generateLayouts(request);

        if (fallback.candidates.length === 0) {
          throw new Error("Local fallback returned no candidates");
        }

        setCandidates(fallback.candidates);
        setNotice(fallback.warnings?.[0] ?? "已使用本地 Mock AI 生成候选");
      }
    } catch {
      setNotice("暂时无法生成排版，请检查图片分析结果后重试");
    } finally {
      setIsGenerating(false);
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
          aria-label="关闭智能排版面板"
          title="关闭面板"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <button 
        className="btn-primary w-full py-2 text-xs font-semibold rounded-lg transition-colors mb-5 shadow-sm shrink-0"
        type="button" 
        disabled={assets.length < 3 || isGenerating} 
        onClick={generate}
      >
        {isGenerating ? "正在生成排版..." : "生成智能排版模板"}
      </button>
      
      {candidates.length > 0 ? (
        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          {candidates.map((candidate) => {
            const strategyScore = getStrategyScore(candidate);
            const templateType = candidate.layout.template?.type ?? "";
            const intent = candidate.layout.guidance.intent;

            return (
            <button
              type="button"
              className="flex flex-col border border-gray-200 rounded-xl p-3 bg-gray-50 hover:bg-white hover:border-gray-950 transition-all cursor-pointer w-full text-left group shadow-sm hover:shadow"
              key={candidate.id}
              onClick={() => void applyLayout(candidate.layout)}
              aria-label={`应用排版: ${candidate.label}`}
              title={candidate.reason}
            >
              {/* Preview Box */}
              <div
                className="relative w-full overflow-hidden rounded-lg bg-white border border-gray-200 mb-3 shadow-sm"
                style={{
                  aspectRatio: `${candidate.layout.canvas.width} / ${candidate.layout.canvas.height}`,
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
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <strong className="block text-xs text-gray-900 font-semibold leading-tight truncate">{candidate.label}</strong>
                    <small className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">{Math.round(candidate.harmonyScore * 100)}% 和谐度</small>
                  </div>
                  {strategyScore ? (
                    <span className="shrink-0 rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {strategyScore.total}
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] leading-4 text-gray-500">
                  {getRecommendationSummary(candidate)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                    {TEMPLATE_TYPE_LABELS[templateType] ?? "模板"}
                  </span>
                  <span className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                    {INTENT_LABELS[intent] ?? "构图"}
                  </span>
                  {strategyScore ? (
                    <span className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      匹配 {strategyScore.fit}
                    </span>
                  ) : null}
                  {strategyScore ? (
                    <span className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      色彩 {strategyScore.color}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
            );
          })}
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
