export class LayoutApprovalProxyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ApprovalProxyDependencies {
  fetch?: typeof globalThis.fetch;
  environment?: Record<string, string | undefined>;
}

interface ApprovalResult {
  session: { id: string; status: "approved"; engine: "langgraph" };
  candidateId: string;
}

function errorMessage(detail: unknown, fallback: string) {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (
    detail &&
    typeof detail === "object" &&
    "error" in detail &&
    typeof detail.error === "string" &&
    detail.error.trim()
  ) {
    return detail.error;
  }
  return fallback;
}

export async function approveLayoutSession(
  sessionId: string,
  candidateId: string,
  dependencies: ApprovalProxyDependencies = {},
): Promise<ApprovalResult> {
  const environment = dependencies.environment ?? process.env;
  const serviceUrl = environment.LAYOUT_ORCHESTRATOR_URL?.trim();
  if (!serviceUrl) {
    throw new LayoutApprovalProxyError(
      503,
      "LAYOUT_ORCHESTRATOR_URL is not configured",
    );
  }

  let response: Response;
  try {
    response = await (dependencies.fetch ?? globalThis.fetch)(
      `${serviceUrl.replace(/\/$/, "")}/v1/layout-sessions/${encodeURIComponent(sessionId)}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new LayoutApprovalProxyError(502, "Layout orchestrator is unavailable");
  }

  const body = (await response.json().catch(() => null)) as
    | {
        session?: { id?: string; status?: string; engine?: string };
        candidate?: { id?: string };
        detail?: unknown;
      }
    | null;
  if (!response.ok) {
    throw new LayoutApprovalProxyError(
      response.status,
      errorMessage(body?.detail, `Layout orchestrator returned ${response.status}`),
    );
  }
  if (
    body?.session?.id !== sessionId ||
    body.session.status !== "approved" ||
    body.session.engine !== "langgraph" ||
    body.candidate?.id !== candidateId
  ) {
    throw new LayoutApprovalProxyError(
      502,
      "Layout orchestrator returned an invalid approval response",
    );
  }

  return {
    session: {
      id: body.session.id,
      status: "approved",
      engine: "langgraph",
    },
    candidateId: body.candidate.id,
  };
}
