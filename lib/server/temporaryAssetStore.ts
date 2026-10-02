import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { analyzePixels } from "@wallpaper/core/image";
import { imageAssetAnalysisSchema } from "@wallpaper/core/layout";
import sharp from "sharp";
import { z } from "zod";

import {
  createVisionProviderFromEnvironment,
  mergeVisionAnalysis,
  type VisionProvider,
} from "./visionProvider.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
const MAX_SESSION_ASSETS = 6;
const THUMBNAIL_SIZE = 480;
const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const buildTemporaryAssetRecordSchema = () =>
  z
  .object({
    version: z.literal("1.0"),
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    accessToken: z.string().uuid(),
    originalName: z.string().min(1).max(180),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    size: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    analysis: imageAssetAnalysisSchema,
    analysisSource: z.enum(["basic", "vision"]),
    analysisWarnings: z.array(z.string()),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const temporaryAssetRecordSchema = z.lazy(buildTemporaryAssetRecordSchema);

export type TemporaryAssetRecord = z.infer<
  typeof temporaryAssetRecordSchema
>;

export interface TemporaryAssetStoreOptions {
  rootDirectory?: string;
  now?: Date;
  ttlMs?: number;
  visionProvider?: VisionProvider | null;
}

export class TemporaryAssetError extends Error {
  readonly code:
    | "invalid_file"
    | "asset_limit"
    | "not_found"
    | "forbidden"
    | "expired";

  constructor(
    code: TemporaryAssetError["code"],
    message: string,
  ) {
    super(message);
    this.name = "TemporaryAssetError";
    this.code = code;
  }
}

function storageRoot(options: TemporaryAssetStoreOptions) {
  return (
    options.rootDirectory ??
    process.env.ONE_TOUCH_STORAGE_DIR?.trim() ??
    path.join(tmpdir(), "one-touch-wallpaper-assets")
  );
}

function pathsFor(root: string, assetId: string) {
  return {
    metadata: path.join(root, `${assetId}.json`),
    original: path.join(root, `${assetId}.original`),
    thumbnail: path.join(root, `${assetId}.thumb.webp`),
  };
}

function safeOriginalName(name: string) {
  const normalized = path.basename(name).replace(/[^\p{L}\p{N}._ -]+/gu, "_");
  return normalized.slice(0, 180) || "wallpaper-image";
}

function mimeTypeForFormat(format: string | undefined) {
  switch (format) {
    case "jpeg":
      return "image/jpeg" as const;
    case "png":
      return "image/png" as const;
    case "webp":
      return "image/webp" as const;
    default:
      return null;
  }
}

async function removeFileIfPresent(filePath: string) {
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

async function writeJsonAtomically(
  filePath: string,
  value: TemporaryAssetRecord,
) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

async function readRecord(
  assetId: string,
  options: TemporaryAssetStoreOptions,
) {
  const root = storageRoot(options);
  const { metadata } = pathsFor(root, assetId);
  try {
    const value = JSON.parse(await readFile(metadata, "utf8")) as unknown;
    return temporaryAssetRecordSchema.parse(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TemporaryAssetError("not_found", "Temporary asset not found");
    }
    throw error;
  }
}

function assertActive(
  record: TemporaryAssetRecord,
  options: TemporaryAssetStoreOptions,
) {
  const now = options.now ?? new Date();
  if (Date.parse(record.expiresAt) <= now.getTime()) {
    throw new TemporaryAssetError("expired", "Temporary asset has expired");
  }
}

async function listActiveRecords(
  sessionId: string,
  options: TemporaryAssetStoreOptions,
) {
  const root = storageRoot(options);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entries = await readdir(root);
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        try {
          const parsed = temporaryAssetRecordSchema.parse(
            JSON.parse(await readFile(path.join(root, entry), "utf8")) as unknown,
          );
          return parsed.sessionId === sessionId &&
            Date.parse(parsed.expiresAt) > (options.now ?? new Date()).getTime()
            ? parsed
            : null;
        } catch {
          return null;
        }
      }),
  );
  return records.filter(
    (record): record is TemporaryAssetRecord => record !== null,
  );
}

async function analyzeBuffer(
  assetId: string,
  buffer: Buffer,
  width: number,
  height: number,
) {
  const sampled = await sharp(buffer)
    .rotate()
    .resize(96, 96, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(
    sampled.data.buffer,
    sampled.data.byteOffset,
    sampled.data.byteLength,
  );
  return analyzePixels({ assetId, width, height, pixels });
}

const VISION_FALLBACK_WARNING_PREFIX =
  "Semantic vision analysis was unavailable; basic image analysis was used.";

// Keeps the recorded warning single-line and bounded even when the cause is a
// multi-line ZodError dump, so the degradation stays observable but compact.
// Zod puts the offending received value at the END of the message, so a plain
// head-truncation would cut it off; keep both ends instead.
function summarizeVisionFailure(error: unknown) {
  const message = (
    error instanceof Error ? error.message : String(error)
  )
    .replace(/\s+/g, " ")
    .trim();
  const bounded =
    message.length > 240
      ? `${message.slice(0, 140)} …[truncated]… ${message.slice(-90)}`
      : message;
  return bounded ? ` Reason: ${bounded}` : "";
}

async function enrichWithVision(
  buffer: Buffer,
  basicAnalysis: ReturnType<typeof analyzePixels>,
  options: TemporaryAssetStoreOptions,
) {
  const provider =
    options.visionProvider === undefined
      ? createVisionProviderFromEnvironment()
      : options.visionProvider;
  if (!provider) {
    return {
      analysis: basicAnalysis,
      source: "basic" as const,
      warnings: [] as string[],
    };
  }
  try {
    const visionBuffer = await sharp(buffer)
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const patch = await provider.analyze({
      buffer: visionBuffer,
      mimeType: "image/jpeg",
      width: basicAnalysis.width,
      height: basicAnalysis.height,
      basicAnalysis,
    });
    return {
      analysis: mergeVisionAnalysis(basicAnalysis, patch),
      source: "vision" as const,
      warnings: [] as string[],
    };
  } catch (error) {
    return {
      analysis: basicAnalysis,
      source: "basic" as const,
      warnings: [
        `${VISION_FALLBACK_WARNING_PREFIX}.${summarizeVisionFailure(error)}`,
      ],
    };
  }
}

export async function cleanupExpiredAssets(
  options: TemporaryAssetStoreOptions = {},
) {
  const root = storageRoot(options);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const now = (options.now ?? new Date()).getTime();
  const entries = await readdir(root);
  let removed = 0;

  for (const entry of entries.filter((value) => value.endsWith(".json"))) {
    const metadataPath = path.join(root, entry);
    try {
      const record = temporaryAssetRecordSchema.parse(
        JSON.parse(await readFile(metadataPath, "utf8")) as unknown,
      );
      if (Date.parse(record.expiresAt) > now) {
        continue;
      }
      const assetPaths = pathsFor(root, record.id);
      await Promise.all([
        removeFileIfPresent(assetPaths.original),
        removeFileIfPresent(assetPaths.thumbnail),
        removeFileIfPresent(assetPaths.metadata),
      ]);
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        continue;
      }
    }
  }

  return removed;
}

export async function storeTemporaryAsset(
  file: File,
  sessionIdInput?: string,
  options: TemporaryAssetStoreOptions = {},
) {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new TemporaryAssetError(
      "invalid_file",
      "Only JPEG, PNG, and WebP images are supported",
    );
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    throw new TemporaryAssetError(
      "invalid_file",
      "Each image must be between 1 byte and 20MB",
    );
  }

  const sessionId = sessionIdInput
    ? z.string().uuid().parse(sessionIdInput)
    : randomUUID();
  await cleanupExpiredAssets(options);
  const activeRecords = await listActiveRecords(sessionId, options);
  if (activeRecords.length >= MAX_SESSION_ASSETS) {
    throw new TemporaryAssetError(
      "asset_limit",
      "A composition can contain at most six images",
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, { failOn: "error" }).metadata();
  } catch {
    throw new TemporaryAssetError(
      "invalid_file",
      "The uploaded file is not a readable image",
    );
  }
  const width = metadata.width;
  const height = metadata.height;
  const detectedMimeType = mimeTypeForFormat(metadata.format);
  if (!width || !height || !detectedMimeType) {
    throw new TemporaryAssetError(
      "invalid_file",
      "The uploaded file has unsupported image metadata",
    );
  }
  if (detectedMimeType !== file.type) {
    throw new TemporaryAssetError(
      "invalid_file",
      "The file content does not match its declared image type",
    );
  }
  if (width * height > MAX_PIXELS) {
    throw new TemporaryAssetError(
      "invalid_file",
      "Images must not exceed 50 megapixels",
    );
  }

  const id = randomUUID();
  const accessToken = randomUUID();
  const now = options.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + (options.ttlMs ?? DAY_MS),
  );
  const basicAnalysis = await analyzeBuffer(id, buffer, width, height);
  const enriched = await enrichWithVision(buffer, basicAnalysis, options);
  const root = storageRoot(options);
  const assetPaths = pathsFor(root, id);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const record = temporaryAssetRecordSchema.parse({
    version: "1.0",
    id,
    sessionId,
    accessToken,
    originalName: safeOriginalName(file.name),
    mimeType: detectedMimeType,
    size: file.size,
    width,
    height,
    analysis: enriched.analysis,
    analysisSource: enriched.source,
    analysisWarnings: enriched.warnings,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  try {
    await writeFile(assetPaths.original, buffer, { mode: 0o600 });
    await sharp(buffer)
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toFile(assetPaths.thumbnail);
    await writeJsonAtomically(assetPaths.metadata, record);
  } catch (error) {
    await Promise.all([
      removeFileIfPresent(assetPaths.original),
      removeFileIfPresent(assetPaths.thumbnail),
      removeFileIfPresent(assetPaths.metadata),
    ]);
    throw error;
  }

  return record;
}

export async function getTemporaryAsset(
  assetId: string,
  sessionId: string,
  options: TemporaryAssetStoreOptions = {},
) {
  const record = await readRecord(z.string().uuid().parse(assetId), options);
  assertActive(record, options);
  if (record.sessionId !== sessionId) {
    throw new TemporaryAssetError(
      "forbidden",
      "This asset does not belong to the current composition",
    );
  }
  return record;
}

export async function readTemporaryAssetContent(
  assetId: string,
  accessToken: string,
  variant: "original" | "thumbnail",
  options: TemporaryAssetStoreOptions = {},
) {
  const record = await readRecord(z.string().uuid().parse(assetId), options);
  assertActive(record, options);
  if (record.accessToken !== accessToken) {
    throw new TemporaryAssetError("forbidden", "Invalid asset access token");
  }
  const assetPaths = pathsFor(storageRoot(options), record.id);
  const content = await readFile(
    variant === "thumbnail" ? assetPaths.thumbnail : assetPaths.original,
  );
  return {
    content,
    contentType:
      variant === "thumbnail" ? "image/webp" : record.mimeType,
    expiresAt: record.expiresAt,
  };
}

export async function readTemporaryAssetOriginalBuffer(
  assetId: string,
  sessionId: string,
  options: TemporaryAssetStoreOptions = {},
): Promise<{
  assetId: string;
  buffer: Buffer;
  mimeType: TemporaryAssetRecord["mimeType"];
}> {
  // Same existence, expiry, and session-ownership checks as getTemporaryAsset.
  const record = await getTemporaryAsset(assetId, sessionId, options);
  const { original } = pathsFor(storageRoot(options), record.id);
  // Size guard before reading (reuse the upload byte limit), then re-check the
  // decoded length in case the file changed between stat and read.
  const stats = await stat(original).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new TemporaryAssetError(
          "not_found",
          "Temporary asset content is missing",
        );
      }
      throw error;
    },
  );
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
    throw new TemporaryAssetError(
      "invalid_file",
      "Temporary asset content exceeds the 20MB limit",
    );
  }
  const buffer = await readFile(original);
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new TemporaryAssetError(
      "invalid_file",
      "Temporary asset content exceeds the 20MB limit",
    );
  }
  return {
    assetId: record.id,
    buffer,
    mimeType: record.mimeType,
  };
}

export async function deleteTemporaryAsset(
  assetId: string,
  sessionId: string,
  options: TemporaryAssetStoreOptions = {},
) {
  const record = await getTemporaryAsset(assetId, sessionId, options);
  const assetPaths = pathsFor(storageRoot(options), record.id);
  await Promise.all([
    removeFileIfPresent(assetPaths.original),
    removeFileIfPresent(assetPaths.thumbnail),
    removeFileIfPresent(assetPaths.metadata),
  ]);
}

export function temporaryAssetPublicView(
  record: TemporaryAssetRecord,
  baseUrl = "",
) {
  const encodedId = encodeURIComponent(record.id);
  const token = encodeURIComponent(record.accessToken);
  return {
    id: record.id,
    name: record.originalName,
    mimeType: record.mimeType,
    size: record.size,
    width: record.width,
    height: record.height,
    aspectRatio: record.width / record.height,
    analysis: record.analysis,
    analysisSource: record.analysisSource,
    analysisWarnings: record.analysisWarnings,
    thumbnailUrl: `${baseUrl}/api/assets/${encodedId}/content?variant=thumbnail&token=${token}`,
    contentUrl: `${baseUrl}/api/assets/${encodedId}/content?variant=original&token=${token}`,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}
