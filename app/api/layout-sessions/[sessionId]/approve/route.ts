import { NextResponse } from "next/server";
import {
  approveLayoutSession,
  LayoutApprovalProxyError,
} from "../../../../../lib/layout-generation/approvalProxy.ts";

type ApprovalBody = { candidateId: string };

function parseApprovalBody(value: unknown): ApprovalBody | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { candidateId?: unknown }).candidateId !== "string" ||
    !(value as { candidateId: string }).candidateId.trim()
  ) {
    return null;
  }

  return { candidateId: (value as { candidateId: string }).candidateId.trim() };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = parseApprovalBody(rawBody);
  if (!body) {
    return NextResponse.json({ error: "candidateId is required" }, { status: 422 });
  }

  try {
    const { sessionId } = await context.params;
    const result = await approveLayoutSession(sessionId, body.candidateId);
    return NextResponse.json({
      session: result.session,
      candidateId: result.candidateId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof LayoutApprovalProxyError
            ? error.message
            : "Unable to approve layout session",
      },
      {
        status: error instanceof LayoutApprovalProxyError ? error.status : 502,
      },
    );
  }
}
