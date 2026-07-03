"use client";

import { useState } from "react";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { createEditorLayoutRequest } from "@wallpaper/core/editor";
import { generateMockLayouts } from "@wallpaper/core/layout-generation";
import { useEditorStore } from "@/store/editorStore";
import type {
  GenerateLayoutRequest,
  GenerateLayoutResponse,
  GenerateLayoutSource,
} from "@wallpaper/core/types";
import type { LayoutCandidate } from "@wallpaper/core/types";

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

const SOURCE_LABELS: Record<GenerateLayoutSource, string> = {
  ai: "模型生成",
  fallback: "本地回退",
  "mock-ai": "本地规则",
  template: "模板",
};

type LayoutSession = NonNullable<GenerateLayoutResponse["session"]>;

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

interface TemplatePreviewBarProps {
  onClose?: () => void;
}

export function TemplatePreviewBar({ onClose }: TemplatePreviewBarProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [approvingCandidateId, setApprovingCandidateId] = useState<string | null>(
    null,
  );
  const [generationMode, setGenerationMode] = useState<"ai" | "local">("ai");
  const [refinePrompt, setRefinePrompt] = useState("");
  const assets = useEditorStore((state) => state.assets);
  const candidates = useEditorStore((state) => state.candidates);
  const candidateSource = useEditorStore((state) => state.candidateSource);
  const layoutSession = useEditorStore((state) => state.layoutSession);
  const canvasSize = useEditorStore((state) => state.canvasSize);
  const ratioId = useEditorStore((state) => state.ratioId);
  const compositionIntent = useEditorStore((state) => state.compositionIntent);
  const currentLayout = useEditorStore((state) => state.currentLayout);
  const setCandidates = useEditorStore((state) => state.setCandidates);
  const setCandidateSource = useEditorStore(
    (state) => state.setCandidateSource,
  );
  const setLayoutSession = useEditorStore((state) => state.setLayoutSession);
  const setNotice = useEditorStore((state) => state.setNotice);
  const { applyLayout } = useEditorCommands();
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const isBusy = isGenerating || approvingCandidateId !== null;

  const generate = async (operation: "generate" | "refine" = "generate") => {
    if (assets.length < 3 || isBusy) {
      return;
    }
    if (operation === "refine" && (!currentLayout || !refinePrompt.trim())) {
      return;
    }

    const request: GenerateLayoutRequest = createEditorLayoutRequest({
      operation,
      mode: generationMode === "ai" ? "ai" : "mock-ai",
      canvasSize,
      ratioId,
      compositionIntent,
      assets: assets.map((asset) => asset.analysis),
      currentLayout,
      userPrompt: refinePrompt,
    });

    setIsGenerating(true);

    try {
      if (generationMode === "local") {
        const result = generateMockLayouts(request);
        if (result.candidates.length === 0) {
          throw new Error("Local rules returned no candidates");
        }
        setCandidates(result.candidates);
        setCandidateSource("mock-ai");
        setLayoutSession(null);
        setNotice("已使用本地规则生成排版候选");
      } else {
        const response = await fetch("/api/generate-layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const failure = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(failure?.error ?? "Layout API request failed");
        }

        const result = (await response.json()) as GenerateLayoutResponse;

        if (result.candidates.length === 0) {
          throw new Error("Layout API returned no candidates");
        }

        setCandidates(result.candidates);
        setCandidateSource(result.source);
        setLayoutSession(result.session ?? null);
        setNotice(
          result.warnings?.[0] ??
            (operation === "refine"
              ? "已生成布局修改候选"
              : result.session
                ? "请选择候选并确认应用"
                : "已生成 AI 排版候选"),
        );
        if (operation === "refine") {
          setRefinePrompt("");
        }
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `排版生成失败：${error.message}`
          : "排版生成失败，请稍后重试",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const applyCandidate = async (candidate: LayoutCandidate) => {
    if (!layoutSession || layoutSession.status !== "awaiting_approval") {
      await applyLayout(candidate.layout);
      return;
    }
    if (isBusy) {
      return;
    }

    setApprovingCandidateId(candidate.id);
    try {
      const response = await fetch(
        `/api/layout-sessions/${encodeURIComponent(layoutSession.id)}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: candidate.id }),
        },
      );
      const result = (await response.json().catch(() => null)) as
        | { candidateId?: string; session?: LayoutSession; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(result?.error ?? "Layout approval request failed");
      }
      if (
        result?.candidateId !== candidate.id ||
        result.session?.status !== "approved"
      ) {
        throw new Error("Layout approval response did not match the candidate");
      }

      setLayoutSession(result.session);
      await applyLayout(candidate.layout);
      setNotice("已确认并应用 LangGraph 排版方案");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `排版确认失败：${error.message}`
          : "排版确认失败，请稍后重试",
      );
    } finally {
      setApprovingCandidateId(null);
    }
  };

  return (
    <aside className="flex flex-col w-full h-full bg-white overflow-y-auto p-5 shrink-0 border-r border-gray-100 select-none">
      <div className="flex items-center justify-between mb-5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">智能排版</h2>
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider font-mono">
            {candidates.length > 0
              ? layoutSession?.status === "awaiting_approval"
                ? "确认后应用排版"
                : "选择排版方向"
              : `照片已就绪: ${assets.length}/3`}
          </span>
        </div>
        <button 
          onClick={onClose}
          className="drawer-close-control"
          aria-label="关闭智能排版面板"
          title="关闭智能排版面板"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
            generationMode === "ai"
              ? "bg-white text-gray-950 shadow-sm"
              : "text-gray-500 hover:text-gray-900"
          }`}
          aria-pressed={generationMode === "ai"}
          onClick={() => setGenerationMode("ai")}
        >
          AI 排版
        </button>
        <button
          type="button"
          className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
            generationMode === "local"
              ? "bg-white text-gray-950 shadow-sm"
              : "text-gray-500 hover:text-gray-900"
          }`}
          aria-pressed={generationMode === "local"}
          onClick={() => setGenerationMode("local")}
        >
          本地规则
        </button>
      </div>

      <button 
        className="btn-primary w-full py-2 text-xs font-semibold rounded-lg transition-colors mb-5 shadow-sm shrink-0"
        type="button" 
        disabled={assets.length < 3 || isBusy}
        onClick={() => void generate("generate")}
      >
        {isGenerating
          ? "正在生成排版..."
          : approvingCandidateId
            ? "正在确认候选..."
          : generationMode === "ai"
            ? "生成 AI 排版"
            : "生成本地排版"}
      </button>

      {generationMode === "ai" && currentLayout ? (
        <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <label
            className="mb-2 block text-[11px] font-semibold text-gray-700"
            htmlFor="layout-refine-prompt"
          >
            修改当前布局
          </label>
          <textarea
            id="layout-refine-prompt"
            className="min-h-20 w-full resize-none rounded-lg border border-gray-200 bg-white p-2 text-xs leading-5 text-gray-800 outline-none transition focus:border-gray-500"
            placeholder="例如：让主图更突出，并保留顶部留白"
            maxLength={1200}
            value={refinePrompt}
            onChange={(event) => setRefinePrompt(event.target.value)}
          />
          <button
            type="button"
            className="mt-2 w-full rounded-lg border border-gray-900 bg-white py-2 text-xs font-semibold text-gray-900 transition hover:bg-gray-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!refinePrompt.trim() || isBusy}
            onClick={() => void generate("refine")}
          >
            生成修改候选
          </button>
        </div>
      ) : null}
      
      {candidates.length > 0 ? (
        <div
          className="flex flex-col gap-4 overflow-y-auto pr-1"
          aria-busy={approvingCandidateId !== null}
        >
          {candidates.map((candidate) => {
            const strategyScore = getStrategyScore(candidate);
            const templateType = candidate.layout.template?.type ?? "";
            const intent = candidate.layout.guidance.intent;

            return (
            <button
              type="button"
              className="flex flex-col border border-gray-200 rounded-xl p-3 bg-gray-50 hover:bg-white hover:border-gray-950 transition-all cursor-pointer w-full text-left group shadow-sm hover:shadow"
              key={candidate.id}
              disabled={isBusy}
              onClick={() => void applyCandidate(candidate)}
              aria-label={`${layoutSession?.status === "awaiting_approval" ? "确认并应用" : "应用"}排版: ${candidate.label}`}
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
                {candidateSource ? (
                  <span className="w-fit rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                    {SOURCE_LABELS[candidateSource]}
                  </span>
                ) : null}
                {layoutSession?.status === "awaiting_approval" ? (
                  <span className="w-fit rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    {approvingCandidateId === candidate.id
                      ? "正在确认…"
                      : "待服务确认（可恢复）"}
                  </span>
                ) : null}
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
