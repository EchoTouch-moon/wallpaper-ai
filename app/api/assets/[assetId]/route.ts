import {
  deleteTemporaryAsset,
  getTemporaryAsset,
  TemporaryAssetError,
  temporaryAssetPublicView,
} from "../../../../lib/server/temporaryAssetStore.ts";
import { ZodError } from "zod";

export const runtime = "nodejs";

interface AssetRouteContext {
  params: Promise<{ assetId: string }>;
}

function sessionIdFrom(request: Request) {
  return (
    request.headers.get("x-one-touch-session") ??
    new URL(request.url).searchParams.get("sessionId")
  );
}

function errorResponse(error: unknown) {
  if (error instanceof TemporaryAssetError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "forbidden"
          ? 403
          : error.code === "expired"
            ? 410
            : 400;
    return Response.json(
      { error: error.message, code: error.code },
      { status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: "Invalid asset request", code: "invalid_request" },
      { status: 400 },
    );
  }
  return Response.json(
    { error: "Unable to access image", code: "storage_failed" },
    { status: 500 },
  );
}

export async function GET(request: Request, context: AssetRouteContext) {
  try {
    const sessionId = sessionIdFrom(request);
    if (!sessionId) {
      return Response.json(
        { error: "A composition session is required", code: "invalid_request" },
        { status: 400 },
      );
    }
    const { assetId } = await context.params;
    const record = await getTemporaryAsset(assetId, sessionId);
    return Response.json(
      { asset: temporaryAssetPublicView(record) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: AssetRouteContext) {
  try {
    const sessionId = sessionIdFrom(request);
    if (!sessionId) {
      return Response.json(
        { error: "A composition session is required", code: "invalid_request" },
        { status: 400 },
      );
    }
    const { assetId } = await context.params;
    await deleteTemporaryAsset(assetId, sessionId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
