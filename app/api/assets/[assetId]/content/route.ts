import {
  readTemporaryAssetContent,
  TemporaryAssetError,
} from "../../../../../lib/server/temporaryAssetStore.ts";
import { ZodError } from "zod";

export const runtime = "nodejs";

interface AssetContentRouteContext {
  params: Promise<{ assetId: string }>;
}

export async function GET(
  request: Request,
  context: AssetContentRouteContext,
) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const variant =
      url.searchParams.get("variant") === "thumbnail"
        ? "thumbnail"
        : "original";
    if (!token) {
      return Response.json(
        { error: "An asset access token is required", code: "invalid_request" },
        { status: 400 },
      );
    }
    const { assetId } = await context.params;
    const result = await readTemporaryAssetContent(
      assetId,
      token,
      variant,
    );
    return new Response(new Uint8Array(result.content), {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "private, max-age=300",
        Expires: result.expiresAt,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
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
        { error: "Invalid asset request", code: "invalid_request" },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Unable to read image", code: "storage_failed" },
      { status: 500 },
    );
  }
}
