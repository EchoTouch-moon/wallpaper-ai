import { editorProjectSchema } from "@/lib/layout/layoutSchema";
import type { ImageAsset } from "@/types/asset";
import type { EditorProject } from "@/types/layout";

const DATABASE_NAME = "wallpaper-studio-v1";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const ASSET_STORE = "assets";
const DRAFT_ID = "local-draft";

interface StoredAsset {
  id: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  blob: Blob;
  analysis: ImageAsset["analysis"];
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open storage"));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Storage request failed"));
  });
}

export async function saveAssetBlob(asset: ImageAsset, blob: Blob) {
  const database = await openDatabase();
  const request = database
    .transaction(ASSET_STORE, "readwrite")
    .objectStore(ASSET_STORE)
    .put({
    id: asset.id,
    name: asset.name,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    blob,
    analysis: asset.analysis,
  } satisfies StoredAsset);
  await requestResult(request);
  database.close();
}

export async function deleteStoredAsset(assetId: string) {
  const database = await openDatabase();
  const request = database
    .transaction(ASSET_STORE, "readwrite")
    .objectStore(ASSET_STORE)
    .delete(assetId);
  await requestResult(request);
  database.close();
}

export async function saveProjectDraft(project: EditorProject) {
  const database = await openDatabase();
  const request = database
    .transaction(PROJECT_STORE, "readwrite")
    .objectStore(PROJECT_STORE)
    .put({ ...project, id: DRAFT_ID });
  await requestResult(request);
  database.close();
}

export async function loadProjectDraft() {
  const database = await openDatabase();
  const storedProject = await requestResult(
    database
      .transaction(PROJECT_STORE, "readonly")
      .objectStore(PROJECT_STORE)
      .get(DRAFT_ID),
  );

  if (!storedProject) {
    database.close();
    return null;
  }

  const parsedProject = editorProjectSchema.safeParse(storedProject);
  if (!parsedProject.success) {
    database.close();
    throw new Error("The local draft is invalid");
  }

  const project = parsedProject.data;
  const transaction = database.transaction(ASSET_STORE, "readonly");
  const store = transaction.objectStore(ASSET_STORE);
  const storedAssets = await Promise.all(
    project.assetIds.map((assetId) =>
      requestResult(store.get(assetId)) as Promise<StoredAsset | undefined>,
    ),
  );
  database.close();

  const availableAssetIds = new Set(
    storedAssets.flatMap((asset) => (asset ? [asset.id] : [])),
  );
  const restoredProject = editorProjectSchema.parse({
    ...project,
    assetIds: project.assetIds.filter((assetId) =>
      availableAssetIds.has(assetId),
    ),
    analyses: project.analyses.filter((analysis) =>
      availableAssetIds.has(analysis.assetId),
    ),
    candidates: project.candidates.filter((candidate) =>
      candidate.layout.items.every((item) =>
        availableAssetIds.has(item.assetId),
      ),
    ),
    currentLayout:
      project.currentLayout?.items.every((item) =>
        availableAssetIds.has(item.assetId),
      )
        ? project.currentLayout
        : null,
  });

  const assets = storedAssets.flatMap((stored): ImageAsset[] => {
    if (!stored) {
      return [];
    }
    const objectUrl = URL.createObjectURL(stored.blob);
    return [
      {
        id: stored.id,
        name: stored.name,
        mimeType: stored.mimeType,
        objectUrl,
        thumbnailUrl: objectUrl,
        width: stored.width,
        height: stored.height,
        aspectRatio: stored.width / stored.height,
        analysis: stored.analysis,
        metadata: {
          orientation: stored.analysis.orientation,
          quality: stored.analysis.resolutionScore,
          dominantColors: stored.analysis.dominantColors,
          bestUse:
            stored.analysis.bestUse?.includes("hero") ||
            stored.analysis.bestUse?.includes("background")
              ? "hero-or-background"
              : "support",
        },
      },
    ];
  });

  return { project: restoredProject, assets };
}
