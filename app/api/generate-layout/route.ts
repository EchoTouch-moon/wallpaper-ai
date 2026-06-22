import { NextResponse } from "next/server";
import {
  createInvalidJsonResponse,
  handleGenerateLayoutRequestAsync,
} from "../../../lib/layout-generation/handleGenerateLayoutRequest.ts";
import { handleLangGraphGenerateLayoutRequest } from "../../../lib/layout-generation/handleLangGraphGenerateLayoutRequest.ts";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    const result = createInvalidJsonResponse();
    return NextResponse.json(result.body, { status: result.status });
  }

  const result =
    process.env.LAYOUT_ENGINE === "langgraph"
      ? await handleLangGraphGenerateLayoutRequest(body)
      : await handleGenerateLayoutRequestAsync(body);
  return NextResponse.json(result.body, { status: result.status });
}
