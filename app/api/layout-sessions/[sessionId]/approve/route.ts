import { NextResponse } from "next/server";
import { z } from "zod";

import { approveLangGraphSession } from "../../../../../lib/layout-generation/langgraphOrchestrator.ts";

const approvalSchema = z
  .object({
    candidateId: z.string().min(1),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const body = approvalSchema.parse(await request.json());
    const { sessionId } = await context.params;
    const result = await approveLangGraphSession(sessionId, body.candidateId);
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
