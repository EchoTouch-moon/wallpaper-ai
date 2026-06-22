import { editorProjectSchema } from "../layout/layoutSchema.ts";
import type { ImageAsset } from "@/types/asset";
import type { LayoutCandidate, WallpaperLayout } from "@/types/layout";
import type { WallpaperRatioId } from "@/types/wallpaper";
import type {
  GenerateLayoutResponse,
  GenerateLayoutSource,
} from "@/types/generateLayout";

type LayoutSession = NonNullable<GenerateLayoutResponse["session"]>;

interface ProjectSnapshotInput {
  createdAt: string;
  assets: ImageAsset[];
  candidates: LayoutCandidate[];
  candidateSource: GenerateLayoutSource | null;
  layoutSession: LayoutSession | null;
  currentLayout: WallpaperLayout | null;
  ratioId: WallpaperRatioId;
  now?: string;
}

export function createProjectSnapshot({
  createdAt,
  assets,
  candidates,
  candidateSource,
  layoutSession,
  currentLayout,
  ratioId,
  now = new Date().toISOString(),
}: ProjectSnapshotInput) {
  return editorProjectSchema.parse({
    version: "1.0",
    id: "local-draft",
    name: "Local wallpaper draft",
    createdAt,
    updatedAt: now,
    ratioId,
    assetIds: assets.map((asset) => asset.id),
    analyses: assets.map((asset) => asset.analysis),
    candidates,
    candidateSource,
    layoutSession,
    currentLayout,
  });
}
