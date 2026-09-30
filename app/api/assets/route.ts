import {
  TemporaryAssetError,
  storeTemporaryAsset,
  temporaryAssetPublicView,
} from "../../../lib/server/temporaryAssetStore.ts";
import { ZodError } from "zod";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof TemporaryAssetError) {
    const status =
      error.code === "asset_limit"
        ? 409
        : error.code === "forbidden"
          ? 403
          : error.code === "not_found"
            ? 404
            : 400;
    return Response.json(
      { error: error.message, code: error.code },
      { status },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: "Invalid asset upload request", code: "invalid_request" },
      { status: 400 },
    );
  }
  return Response.json(
    { error: "Unable to store image", code: "storage_failed" },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const sessionId = formData.get("sessionId");
    if (!(file instanceof File)) {
      return Response.json(
        { error: "A file field is required", code: "invalid_request" },
        { status: 400 },
      );
    }
    if (sessionId !== null && typeof sessionId !== "string") {
      return Response.json(
        { error: "sessionId must be a string", code: "invalid_request" },
        { status: 400 },
      );
    }

    const record = await storeTemporaryAsset(file, sessionId ?? undefined);
    return Response.json(
      {
        sessionId: record.sessionId,
        asset: temporaryAssetPublicView(record),
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
