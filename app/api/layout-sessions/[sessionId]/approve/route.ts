import { NextResponse } from "next/server";

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

  return { candidateId: (value as { candidateId: string }).candidateId };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const body = parseApprovalBody(await request.json());
    if (!body) {
      return NextResponse.json({ error: "candidateId is required" }, { status: 422 });
    }
    const { sessionId } = await context.params;
    const serviceUrl = process.env.LAYOUT_ORCHESTRATOR_URL?.trim();
    if (!serviceUrl) {
      return NextResponse.json(
        { error: "LAYOUT_ORCHESTRATOR_URL is not configured" },
        { status: 503 },
      );
    }

    const response = await fetch(
      `${serviceUrl.replace(/\/$/, "")}/v1/layout-sessions/${encodeURIComponent(sessionId)}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const result = (await response.json().catch(() => null)) as
      | {
          session?: { id?: string; status?: string; engine?: string };
          candidate?: { id?: string };
          detail?: unknown;
        }
      | null;
    if (!response.ok) {
      return NextResponse.json(
        { error: result?.detail ?? `Layout orchestrator returned ${response.status}` },
        { status: response.status },
      );
    }
    if (
      result?.session?.id !== sessionId ||
      result.session.status !== "approved" ||
      result.session.engine !== "langgraph" ||
      result.candidate?.id !== body.candidateId
    ) {
      return NextResponse.json(
        { error: "Layout orchestrator returned an invalid approval response" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      session: result.session,
      candidateId: result.candidate.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to approve layout session",
      },
      { status: 422 },
    );
  }
}
