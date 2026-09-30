import { ZodError } from "zod";

import {
  undoCompositionRefinementRequestSchema,
} from "../../../../../packages/core/src/layout-generation/compositionApi.ts";
import {
  CompositionSessionError,
  compositionSessionPublicView,
  undoCompositionRefinement,
} from "../../../../../lib/server/compositionSessionStore.ts";

export const runtime = "nodejs";

interface CompositionUndoRouteContext {
  params: Promise<{ compositionId: string }>;
}

export async function POST(
  request: Request,
  context: CompositionUndoRouteContext,
) {
  try {
    const input = undoCompositionRefinementRequestSchema.parse(
      await request.json(),
    );
    const { compositionId } = await context.params;
    const result = await undoCompositionRefinement(
      compositionId,
      input.sessionId,
      input.candidateId,
    );
    return Response.json(
      {
        composition: compositionSessionPublicView(result.record),
        candidate: result.candidate,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "Request body must be valid JSON", code: "invalid_json" },
        { status: 400 },
      );
    }
    if (error instanceof CompositionSessionError) {
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
        { error: "Invalid undo request", code: "invalid_request" },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Unable to undo refinement", code: "undo_failed" },
      { status: 500 },
    );
  }
}
