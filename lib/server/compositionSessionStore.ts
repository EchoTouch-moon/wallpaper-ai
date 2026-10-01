import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  compositionBriefSchema,
  compositionRefineRequestSchema,
  generateCompositionCandidatesAsync,
  refineCompositionCandidateAsync,
  loadVisionPlanningConfig,
  visionPlanningGateRequested,
  type AssetContentReference,
  type LayoutModelProvider,
} from "@wallpaper/core/layout-generation";
import { layoutCandidateSchema } from "@wallpaper/core/layout";
import type { LayoutCandidate } from "@wallpaper/core/types";
import { z } from "zod";

import type {
  TemporaryAssetRecord,
  TemporaryAssetStoreOptions,
} from "./temporaryAssetStore.ts";
import { readTemporaryAssetOriginalBuffer } from "./temporaryAssetStore.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_REVISIONS = 20;

const buildCompositionRevisionSchema = () =>
  z
  .object({
    id: z.string().uuid(),
    candidateId: z.string().min(1),
    instruction: z.string().min(1).max(800),
    previousCandidate: layoutCandidateSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

const compositionRevisionSchema = z.lazy(buildCompositionRevisionSchema);

const buildCompositionSessionRecordSchema = () =>
  z
  .object({
    version: z.literal("1.0"),
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    status: z.enum(["generating", "ready", "failed"]),
    stage: z.enum([
      "planning",
      "compiling",
      "rendering",
      "ready",
      "failed",
    ]),
    brief: compositionBriefSchema,
    assetIds: z.array(z.string().uuid()).min(2).max(6),
    candidates: z.array(layoutCandidateSchema).length(3),
    source: z.enum(["ai", "recipe-fallback"]),
    warnings: z.array(z.string()),
    revisions: z.array(compositionRevisionSchema).max(MAX_REVISIONS),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const compositionSessionRecordSchema = z.lazy(
  buildCompositionSessionRecordSchema,
);

export type CompositionSessionRecord = z.infer<
  typeof compositionSessionRecordSchema
>;

export interface CompositionStoreOptions {
  rootDirectory?: string;
  now?: Date;
  ttlMs?: number;
  compositionProvider?: LayoutModelProvider;
  environment?: Record<string, string | undefined>;
  /**
   * Forwarded to the temporary asset store when multimodal planning reads the
   * original buffers (tests inject an isolated root; production uses the
   * default ONE_TOUCH_STORAGE_DIR layout).
   */
  assetStoreOptions?: TemporaryAssetStoreOptions;
}

export class CompositionSessionError extends Error {
  readonly code: "not_found" | "forbidden" | "expired" | "invalid_candidate";

  constructor(
    code: CompositionSessionError["code"],
    message: string,
  ) {
    super(message);
    this.name = "CompositionSessionError";
    this.code = code;
  }
}

function storeRoot(options: CompositionStoreOptions) {
  return (
    options.rootDirectory ??
    process.env.ONE_TOUCH_COMPOSITION_DIR?.trim() ??
    path.join(tmpdir(), "one-touch-wallpaper-compositions")
  );
}

function recordPath(root: string, compositionId: string) {
  return path.join(root, `${compositionId}.json`);
}

async function removeIfPresent(filePath: string) {
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

async function writeRecord(
  record: CompositionSessionRecord,
  options: CompositionStoreOptions,
) {
  const root = storeRoot(options);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = recordPath(root, record.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(record), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target);
}

async function readRecord(
  compositionId: string,
  options: CompositionStoreOptions,
) {
  const id = z.string().uuid().parse(compositionId);
  try {
    return compositionSessionRecordSchema.parse(
      JSON.parse(
        await readFile(recordPath(storeRoot(options), id), "utf8"),
      ) as unknown,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CompositionSessionError(
        "not_found",
        "Composition session not found",
      );
    }
    throw error;
  }
}

function assertSessionAccess(
  record: CompositionSessionRecord,
  sessionId: string,
  options: CompositionStoreOptions,
) {
  if (record.sessionId !== sessionId) {
    throw new CompositionSessionError(
      "forbidden",
      "This composition belongs to another session",
    );
  }
  if (Date.parse(record.expiresAt) <= (options.now ?? new Date()).getTime()) {
    throw new CompositionSessionError(
      "expired",
      "Composition session has expired",
    );
  }
}

/**
 * Multimodal planning gate (packages/core/src/layout-generation/llmConfig.ts):
 * asset buffers are only read from disk when VISION_PLANNING_ENABLED resolves
 * to a usable vision configuration. With the gate off, no asset file is read
 * at all and the request stays byte-identical to the previous text-only shape.
 */
function visionPlanningGateEnabled(options: CompositionStoreOptions) {
  return loadVisionPlanningConfig(options.environment ?? process.env) !== null;
}

/**
 * Reads every asset's original buffer and assembles inline data URLs strictly
 * in memory for the injected provider. dataUrls are never written to disk and
 * never logged; any unreadable asset degrades the whole request to text-only
 * planning (observable through the returned warning) without blocking
 * generation.
 */
async function assembleAssetContent(
  sessionId: string,
  assets: TemporaryAssetRecord[],
  options: CompositionStoreOptions,
): Promise<AssetContentReference[]> {
  const references: AssetContentReference[] = [];
  for (const asset of assets) {
    const content = await readTemporaryAssetOriginalBuffer(
      asset.id,
      sessionId,
      options.assetStoreOptions ?? {},
    );
    references.push({
      assetId: content.assetId,
      dataUrl: `data:${content.mimeType};base64,${content.buffer.toString("base64")}`,
    });
  }
  return references;
}

function visionAssemblyWarning(error: unknown) {
  return `Vision planning asset content was unavailable; fell back to text-only planning. (${
    error instanceof Error ? error.message : "unknown error"
  })`;
}

/**
 * Degradation observability for the gate itself (plan/multimodal-planning-
 * protocol-design.md §2.4): with VISION_PLANNING_ENABLED=true but no usable
 * key/model, the request silently degrades to text-only planning. This
 * deterministic warning keeps that tier observable in the response warnings
 * instead of making flag-on and flag-off states indistinguishable.
 */
const VISION_GATE_UNCONFIGURED_WARNING =
  "Vision planning is enabled but no usable model configuration was found; using text-only planning.";

function visionGateObservabilityWarnings(
  options: CompositionStoreOptions,
): string[] {
  const environment = options.environment ?? process.env;
  return visionPlanningGateRequested(environment) &&
    loadVisionPlanningConfig(environment) === null
    ? [VISION_GATE_UNCONFIGURED_WARNING]
    : [];
}

export async function cleanupExpiredCompositions(
  options: CompositionStoreOptions = {},
) {
  const root = storeRoot(options);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const now = (options.now ?? new Date()).getTime();
  const entries = await readdir(root);
  let removed = 0;
  for (const entry of entries.filter((value) => value.endsWith(".json"))) {
    const filePath = path.join(root, entry);
    try {
      const record = compositionSessionRecordSchema.parse(
        JSON.parse(await readFile(filePath, "utf8")) as unknown,
      );
      if (Date.parse(record.expiresAt) <= now) {
        await removeIfPresent(filePath);
        removed += 1;
      }
    } catch {
      continue;
    }
  }
  return removed;
}

export async function createCompositionSession(
  sessionId: string,
  briefInput: unknown,
  assets: TemporaryAssetRecord[],
  options: CompositionStoreOptions = {},
) {
  const brief = compositionBriefSchema.parse(briefInput);
  const parsedSessionId = z.string().uuid().parse(sessionId);
  if (
    assets.length < 2 ||
    assets.length > 6 ||
    assets.some((asset) => asset.sessionId !== parsedSessionId)
  ) {
    throw new CompositionSessionError(
      "forbidden",
      "The composition assets do not belong to this session",
    );
  }
  await cleanupExpiredCompositions(options);
  let assetContent: AssetContentReference[] | undefined;
  const assemblyWarnings: string[] = [];
  if (visionPlanningGateEnabled(options)) {
    try {
      assetContent = await assembleAssetContent(
        parsedSessionId,
        assets,
        options,
      );
    } catch (error) {
      // Any unreadable asset degrades the whole request to text-only planning;
      // the wiring failure never blocks generation.
      assetContent = undefined;
      assemblyWarnings.push(visionAssemblyWarning(error));
    }
  }
  const generated = await generateCompositionCandidatesAsync(
    {
      brief,
      assets: assets.map((asset) => asset.analysis),
      candidateCount: 3,
      ...(assetContent ? { assetContent } : {}),
    },
    {
      provider: options.compositionProvider,
      environment: options.environment,
    },
  );
  const now = options.now ?? new Date();
  const requestedExpiry = now.getTime() + (options.ttlMs ?? DAY_MS);
  const assetExpiry = Math.min(
    ...assets.map((asset) => Date.parse(asset.expiresAt)),
  );
  const expiresAt = new Date(Math.min(requestedExpiry, assetExpiry));
  const record = compositionSessionRecordSchema.parse({
    version: "1.0",
    id: randomUUID(),
    sessionId: parsedSessionId,
    status: "ready",
    stage: "ready",
    brief,
    assetIds: assets.map((asset) => asset.id),
    candidates: generated.candidates,
    source: generated.source,
    warnings: [
      ...visionGateObservabilityWarnings(options),
      ...assemblyWarnings,
      ...generated.warnings,
    ],
    revisions: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  await writeRecord(record, options);
  return record;
}

export async function getCompositionSession(
  compositionId: string,
  sessionId: string,
  options: CompositionStoreOptions = {},
) {
  const record = await readRecord(compositionId, options);
  assertSessionAccess(record, z.string().uuid().parse(sessionId), options);
  return record;
}

export async function refineCompositionSession(
  compositionId: string,
  sessionId: string,
  candidateId: string,
  instruction: string,
  locked: {
    target: boolean;
    heroAsset: boolean;
    safeAreas: boolean;
  },
  assets: TemporaryAssetRecord[],
  options: CompositionStoreOptions = {},
) {
  const record = await getCompositionSession(
    compositionId,
    sessionId,
    options,
  );
  const candidateIndex = record.candidates.findIndex(
    (candidate) => candidate.id === candidateId,
  );
  if (candidateIndex < 0) {
    throw new CompositionSessionError(
      "invalid_candidate",
      "The selected candidate does not exist",
    );
  }
  const current = record.candidates[candidateIndex];
  let assetContent: AssetContentReference[] | undefined;
  const assemblyWarnings: string[] = [];
  if (visionPlanningGateEnabled(options)) {
    try {
      assetContent = await assembleAssetContent(sessionId, assets, options);
    } catch (error) {
      // Same degradation contract as generation: text-only planning, never a
      // blocked refinement.
      assetContent = undefined;
      assemblyWarnings.push(visionAssemblyWarning(error));
    }
  }
  const refineRequest = compositionRefineRequestSchema.parse({
    brief: record.brief,
    assets: assets.map((asset) => asset.analysis),
    currentLayout: current.layout,
    instruction,
    locked,
    ...(assetContent ? { assetContent } : {}),
  });
  const currentRecipe = refineRequest.currentLayout.template?.recipe;
  if (!currentRecipe) {
    throw new CompositionSessionError(
      "invalid_candidate",
      "The selected candidate cannot be refined",
    );
  }
  const refined = await refineCompositionCandidateAsync(refineRequest, {
    provider: options.compositionProvider,
    environment: options.environment,
  });
  const revisionNumber = record.revisions.length + 2;
  const nextCandidate: LayoutCandidate = {
    ...refined.candidate,
    id: `${candidateId.replace(/_v\d+$/, "")}_v${revisionNumber}`,
    label: current.label,
    reason:
      refined.source === "ai"
        ? refined.candidate.reason
        : `Refined from “${refineRequest.instruction}”`,
  };
  const now = options.now ?? new Date();
  const candidates = [...record.candidates];
  candidates[candidateIndex] = nextCandidate;
  const nextRecord = compositionSessionRecordSchema.parse({
    ...record,
    candidates,
    source: refined.source === "ai" ? "ai" : record.source,
    warnings: [
      ...record.warnings,
      ...visionGateObservabilityWarnings(options),
      ...assemblyWarnings,
      ...refined.warnings,
    ].slice(-8),
    revisions: [
      ...record.revisions.slice(-(MAX_REVISIONS - 1)),
      {
        id: randomUUID(),
        candidateId: nextCandidate.id,
        instruction: refineRequest.instruction,
        previousCandidate: current,
        createdAt: now.toISOString(),
      },
    ],
    updatedAt: now.toISOString(),
  });
  await writeRecord(nextRecord, options);
  return { record: nextRecord, candidate: nextCandidate };
}

export async function undoCompositionRefinement(
  compositionId: string,
  sessionId: string,
  candidateId: string,
  options: CompositionStoreOptions = {},
) {
  const record = await getCompositionSession(
    compositionId,
    sessionId,
    options,
  );
  const revision = record.revisions.at(-1);
  if (!revision || revision.candidateId !== candidateId) {
    throw new CompositionSessionError(
      "invalid_candidate",
      "There is no refinement to undo for this candidate",
    );
  }
  const candidateIndex = record.candidates.findIndex(
    (candidate) => candidate.id === candidateId,
  );
  if (candidateIndex < 0) {
    throw new CompositionSessionError(
      "invalid_candidate",
      "The refined candidate no longer exists",
    );
  }
  const candidates = [...record.candidates];
  candidates[candidateIndex] = revision.previousCandidate;
  const now = options.now ?? new Date();
  const nextRecord = compositionSessionRecordSchema.parse({
    ...record,
    candidates,
    revisions: record.revisions.slice(0, -1),
    updatedAt: now.toISOString(),
  });
  await writeRecord(nextRecord, options);
  return {
    record: nextRecord,
    candidate: revision.previousCandidate,
  };
}

export async function deleteCompositionSession(
  compositionId: string,
  sessionId: string,
  options: CompositionStoreOptions = {},
) {
  const record = await getCompositionSession(
    compositionId,
    sessionId,
    options,
  );
  await removeIfPresent(recordPath(storeRoot(options), record.id));
}

export function compositionSessionPublicView(
  record: CompositionSessionRecord,
) {
  return {
    id: record.id,
    status: record.status,
    stage: record.stage,
    brief: record.brief,
    assetIds: record.assetIds,
    candidates: record.candidates,
    source: record.source,
    warnings: record.warnings,
    revisionCount: record.revisions.length,
    canUndoCandidateId: record.revisions.at(-1)?.candidateId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
  };
}
