"use client";

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useEditorCommands } from "@/components/editor/EditorProvider";
import { createImageAsset } from "@/lib/image/extractMetadata";
import { saveAssetBlob } from "@/lib/storage/projectDatabase";
import { useEditorStore } from "@/store/editorStore";

interface AssetPanelProps {
  onClose?: () => void;
}

export function AssetPanel({ onClose }: AssetPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const assets = useEditorStore((state) => state.assets);
  const addAssets = useEditorStore((state) => state.addAssets);
  const setNotice = useEditorStore((state) => state.setNotice);
  const { addImage, removeAsset } = useEditorCommands();

  const processFiles = async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    const results = await Promise.allSettled(fileList.map(createImageAsset));
    const validEntries = results.flatMap((result, index) =>
      result.status === "fulfilled"
        ? [{ asset: result.value, file: fileList[index] }]
        : [],
    );
    const validAssets = validEntries.map((entry) => entry.asset);

    if (validAssets.length > 0) {
      const storageResults = await Promise.allSettled(
        validEntries.map(({ asset, file }) => saveAssetBlob(asset, file)),
      );
      addAssets(validAssets);
      const storageFailures = storageResults.filter(
        (result) => result.status === "rejected",
      ).length;
      setNotice(
        storageFailures > 0
          ? "Photos added, but local saving is unavailable"
          : `${validAssets.length} photo${validAssets.length > 1 ? "s" : ""} added`,
      );
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
    <aside className="flex flex-col w-full h-full bg-white overflow-y-auto p-5 shrink-0 border-r border-gray-100">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-gray-900">素材库</h2>
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider font-mono">{assets.length} 个项目</span>
        </div>
        <button 
          onClick={onClose}
          className="drawer-close-control"
          aria-label="关闭素材面板"
          title="关闭素材面板"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={handleInput}
      />
      
      <button
        className={`w-full h-28 flex flex-col items-center justify-center border border-dashed rounded-xl text-xs transition-colors cursor-pointer shrink-0
          ${isDragging ? "border-black bg-gray-50" : "border-gray-300 bg-gray-50/50 hover:bg-gray-50 hover:border-gray-400"}
        `}
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
        <div className="w-8 h-8 rounded-full border border-gray-200 bg-white shadow-sm flex items-center justify-center text-gray-600 mb-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </div>
        <strong className="text-gray-900 font-medium mb-0.5">上传图片</strong>
        <span className="text-gray-400 text-[10px]">支持 JPG, PNG, WebP 格式</span>
      </button>
      
      {assets.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 mt-4">
          {assets.map((asset) => (
            <article className="group relative rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:border-gray-300 transition-colors" key={asset.id}>
              <button
                className="w-full aspect-square relative block bg-gray-100 p-0 m-0 border-b border-gray-200"
                type="button"
                onClick={() => void addImage(asset)}
                title={`将 ${asset.name} 添加至画布`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.thumbnailUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              </button>
              
              <div className="p-2 flex flex-col gap-1">
                <div className="flex flex-col">
                  <span className="text-[9px] font-medium text-gray-800 truncate" title={asset.name}>{asset.name}</span>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex -space-x-1">
                    {asset.analysis.dominantColors.slice(0, 3).map((color, index) => (
                      <i
                        key={`${color}-${index}`}
                        className="w-2.5 h-2.5 rounded-full border border-white shadow-sm"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <button
                    className="w-4 h-4 flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    type="button"
                    title="移除"
                    onClick={() => removeAsset(asset.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
