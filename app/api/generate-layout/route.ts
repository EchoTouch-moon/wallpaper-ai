import { NextResponse } from "next/server";
import {
  createInvalidJsonResponse,
  handleGenerateLayoutRequestAsync,
} from "@wallpaper/core/layout-generation";
import { handleLangGraphGenerateLayoutRequest } from "@wallpaper/core/layout-generation";

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
