import { ZodError } from "zod";

import {
  createCompositionSessionRequestSchema,
} from "../../../packages/core/src/layout-generation/compositionApi.ts";
import {
  CompositionSessionError,
  compositionSessionPublicView,
  createCompositionSession,
} from "../../../lib/server/compositionSessionStore.ts";
import {
  getTemporaryAsset,
  TemporaryAssetError,
} from "../../../lib/server/temporaryAssetStore.ts";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
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
  if (error instanceof TemporaryAssetError) {
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
        error: "Invalid composition request",
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
    { error: "Unable to generate composition", code: "generation_failed" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const input = createCompositionSessionRequestSchema.parse(
      await request.json(),
    );
    const assets = await Promise.all(
      input.assetIds.map((assetId) =>
        getTemporaryAsset(assetId, input.sessionId),
      ),
    );
    const composition = await createCompositionSession(
      input.sessionId,
      input.brief,
      assets,
    );
    return Response.json(
      { composition: compositionSessionPublicView(composition) },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
