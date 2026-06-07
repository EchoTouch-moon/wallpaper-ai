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
      setNotice("Three color-aware triptych directions generated");
    } catch {
      setNotice("Could not generate triptych directions");
    }
  };

  return (
    <div className="template-dock editor-glass">
      <div className="template-dock-heading">
        <div>
          <span>Color-aware layouts</span>
          <strong>
            {candidates.length > 0
              ? "Choose a direction"
              : `${assets.length}/3 photos ready`}
          </strong>
        </div>
        <button type="button" disabled={assets.length < 3} onClick={generate}>
          Generate 3
        </button>
      </div>
      {candidates.length > 0 ? (
        <div className="template-candidates">
          {candidates.map((candidate) => (
            <button
              type="button"
              className="template-card"
              key={candidate.id}
              onClick={() => void applyLayout(candidate.layout)}
              title={candidate.reason}
            >
              <span
                className="template-miniature"
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
              </span>
              <span className="template-card-copy">
                <strong>{candidate.label}</strong>
                <small>{Math.round(candidate.harmonyScore * 100)}% harmony</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
