import { aiLayoutPlanResponseSchema } from "./aiPlanSchema.ts";

import type {
  AiLayoutPlanCandidate,
  AiLayoutPlanResponse,
} from "./aiPlanSchema.ts";
import type { GenerateLayoutRequest } from "@/types/generateLayout";

export class LangGraphOrchestratorError extends Error {}

export interface LangGraphSession {
  id: string;
  status: "awaiting_approval" | "approved";
  engine: "langgraph";
}

interface StartSessionPayload {
  session: LangGraphSession;
  plan: AiLayoutPlanResponse;
}

interface ApprovalPayload {
  session: LangGraphSession;
  candidate: AiLayoutPlanCandidate;
}

interface LangGraphDependencies {
  fetch?: typeof globalThis.fetch;
  environment?: Record<string, string | undefined>;
}

function serviceUrl(environment: Record<string, string | undefined>) {
  const value = environment.LAYOUT_ORCHESTRATOR_URL?.trim();
  if (!value) {
    throw new LangGraphOrchestratorError(
      "LAYOUT_ORCHESTRATOR_URL is not configured",
    );
  }
  return value.replace(/\/$/, "");
}

async function readJson(response: Response) {
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "detail" in body
        ? JSON.stringify(body.detail)
        : `Layout orchestrator returned ${response.status}`;
    throw new LangGraphOrchestratorError(message);
  }
  return body;
}

export async function startLangGraphSession(
  request: GenerateLayoutRequest,
  dependencies: LangGraphDependencies = {},
): Promise<StartSessionPayload> {
  const environment = dependencies.environment ?? process.env;
  const send = dependencies.fetch ?? globalThis.fetch;
  const response = await send(`${serviceUrl(environment)}/v1/layout-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await readJson(response);
  if (!body || typeof body !== "object" || !("session" in body) || !("plan" in body)) {
    throw new LangGraphOrchestratorError("Layout orchestrator returned invalid JSON");
  }

  const payload = body as {
    session: LangGraphSession;
    plan: unknown;
  };
  if (
    payload.session.status !== "awaiting_approval" ||
    payload.session.engine !== "langgraph"
  ) {
    throw new LangGraphOrchestratorError("Layout orchestrator returned invalid session");
  }
  return {
    session: payload.session,
    plan: aiLayoutPlanResponseSchema.parse(payload.plan),
  };
}

export async function approveLangGraphSession(
  sessionId: string,
  candidateId: string,
  dependencies: LangGraphDependencies = {},
): Promise<ApprovalPayload> {
  const environment = dependencies.environment ?? process.env;
  const send = dependencies.fetch ?? globalThis.fetch;
  const response = await send(
    `${serviceUrl(environment)}/v1/layout-sessions/${encodeURIComponent(sessionId)}/approval`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    },
  );
  const body = await readJson(response);
  if (!body || typeof body !== "object" || !("session" in body) || !("candidate" in body)) {
    throw new LangGraphOrchestratorError("Layout orchestrator returned invalid JSON");
  }

  const payload = body as {
    session: LangGraphSession;
    candidate: unknown;
  };
  if (payload.session.status !== "approved" || payload.session.engine !== "langgraph") {
    throw new LangGraphOrchestratorError("Layout session did not reach approval");
  }
  const plan = aiLayoutPlanResponseSchema.parse({ candidates: [payload.candidate] });
  return { session: payload.session, candidate: plan.candidates[0] };
}
