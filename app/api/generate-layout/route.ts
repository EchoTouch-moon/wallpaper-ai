import { NextResponse } from "next/server";
import { handleGenerateLayoutRequest } from "../../../lib/layout-generation/handleGenerateLayoutRequest.ts";

export async function POST(request: Request) {
  const body = await request.json();
  const result = handleGenerateLayoutRequest(body);
  return NextResponse.json(result.body, { status: result.status });
}
