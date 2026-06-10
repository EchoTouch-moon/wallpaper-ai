import { NextResponse } from "next/server";
import {
  createInvalidJsonResponse,
  handleGenerateLayoutRequestAsync,
} from "../../../lib/layout-generation/handleGenerateLayoutRequest.ts";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    const result = createInvalidJsonResponse();
    return NextResponse.json(result.body, { status: result.status });
  }

  const result = await handleGenerateLayoutRequestAsync(body);
  return NextResponse.json(result.body, { status: result.status });
}
