import { ZodError } from "zod";

import {
  CompositionSessionError,
  compositionSessionPublicView,
  deleteCompositionSession,
  getCompositionSession,
} from "../../../../lib/server/compositionSessionStore.ts";

export const runtime = "nodejs";

interface CompositionRouteContext {
  params: Promise<{ compositionId: string }>;
}

function sessionIdFrom(request: Request) {
  return (
    request.headers.get("x-one-touch-session") ??
    new URL(request.url).searchParams.get("sessionId")
  );
}

function errorResponse(error: unknown) {
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
      { error: "Invalid composition request", code: "invalid_request" },
      { status: 400 },
    );
  }
  return Response.json(
    { error: "Unable to access composition", code: "storage_failed" },
    { status: 500 },
  );
}

export async function GET(
  request: Request,
  context: CompositionRouteContext,
) {
  try {
    const sessionId = sessionIdFrom(request);
    if (!sessionId) {
      return Response.json(
        { error: "A composition session is required", code: "invalid_request" },
        { status: 400 },
      );
    }
    const { compositionId } = await context.params;
    const composition = await getCompositionSession(
      compositionId,
      sessionId,
    );
    return Response.json(
      { composition: compositionSessionPublicView(composition) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: CompositionRouteContext,
) {
  try {
    const sessionId = sessionIdFrom(request);
    if (!sessionId) {
      return Response.json(
        { error: "A composition session is required", code: "invalid_request" },
        { status: 400 },
      );
    }
    const { compositionId } = await context.params;
    await deleteCompositionSession(compositionId, sessionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
