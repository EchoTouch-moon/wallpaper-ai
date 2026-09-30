import { ZodError } from "zod";

import {
  refineCompositionSessionRequestSchema,
} from "../../../../../packages/core/src/layout-generation/compositionApi.ts";
import {
  CompositionSessionError,
  compositionSessionPublicView,
  getCompositionSession,
  refineCompositionSession,
} from "../../../../../lib/server/compositionSessionStore.ts";
import {
  getTemporaryAsset,
  TemporaryAssetError,
} from "../../../../../lib/server/temporaryAssetStore.ts";

export const runtime = "nodejs";

interface CompositionRefineRouteContext {
  params: Promise<{ compositionId: string }>;
}

function errorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return Response.json(
      { error: "Request body must be valid JSON", code: "invalid_json" },
      { status: 400 },
    );
  }
  if (
    error instanceof CompositionSessionError ||
    error instanceof TemporaryAssetError
  ) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "expired"
          ? 410
          : error.code === "forbidden"
            ? 403
            : 400;
    return Response.json(
      { error: error.message, code: error.code },
      { status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: "Invalid refinement request",
        code: "invalid_request",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  return Response.json(
    { error: "Unable to refine composition", code: "refinement_failed" },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  context: CompositionRefineRouteContext,
) {
  try {
    const input = refineCompositionSessionRequestSchema.parse(
      await request.json(),
    );
    const { compositionId } = await context.params;
    const current = await getCompositionSession(
      compositionId,
      input.sessionId,
    );
    const assets = await Promise.all(
      current.assetIds.map((assetId) =>
        getTemporaryAsset(assetId, input.sessionId),
      ),
    );
    const refined = await refineCompositionSession(
      compositionId,
      input.sessionId,
      input.candidateId,
      input.instruction,
      input.locked,
      assets,
    );

    return Response.json(
      {
        composition: compositionSessionPublicView(refined.record),
        candidate: refined.candidate,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
