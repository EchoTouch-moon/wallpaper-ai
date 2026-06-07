"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { createImageAsset } from "@/lib/image/extractMetadata";
import { useEditorStore } from "@/store/editorStore";

export function AssetPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const assets = useEditorStore((state) => state.assets);
  const addAssets = useEditorStore((state) => state.addAssets);
  const setNotice = useEditorStore((state) => state.setNotice);
  const { addImage, removeAsset } = useEditorCommands();

  const processFiles = async (files: FileList | File[]) => {
    const results = await Promise.allSettled(Array.from(files).map(createImageAsset));
    const validAssets = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    if (validAssets.length > 0) {
      addAssets(validAssets);
      setNotice(`${validAssets.length} photo${validAssets.length > 1 ? "s" : ""} added`);
    }

    const rejectedCount = results.length - validAssets.length;
    if (rejectedCount > 0) {
      setNotice(`${rejectedCount} file${rejectedCount > 1 ? "s" : ""} could not be added`);
    }
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      void processFiles(event.target.files);
      event.target.value = "";
    }
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length > 0) {
      void processFiles(event.dataTransfer.files);
    }
  };

  return (
    <aside className="side-panel left editor-glass">
      <div className="panel-heading">
        <h2>Assets</h2>
        <span>{assets.length} items</span>
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={handleInput}
      />
      <button
        className={`upload-placeholder ${isDragging ? "is-dragging" : ""}`}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <span>
          <span className="upload-icon" aria-hidden="true">
            +
          </span>
          <strong>Add your photos</strong>
          Drop JPG, PNG or WebP here
        </span>
      </button>
      {assets.length > 0 ? (
        <div className="asset-grid">
          {assets.map((asset) => (
            <article className="asset-card" key={asset.id}>
              <button
                className="asset-preview"
                type="button"
                onClick={() => void addImage(asset)}
                title={`Add ${asset.name} to canvas`}
              >
                {/* Local object URLs are intentionally rendered without Next Image optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.thumbnailUrl} alt="" />
                <span>Add to canvas</span>
              </button>
              <div className="asset-details">
                <div className="asset-copy">
                  <span title={asset.name}>{asset.name}</span>
                  <small>
                    {asset.analysis.orientation} · Q
                    {Math.round(asset.analysis.resolutionScore * 100)}
                  </small>
                </div>
                <div className="asset-swatches" aria-label="Dominant colors">
                  {asset.analysis.dominantColors.map((color, index) => (
                    <i
                      key={`${color}-${index}`}
                      title={color}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${asset.name}`}
                  onClick={() => removeAsset(asset.id)}
                >
                  ×
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
