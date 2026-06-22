import assert from "node:assert/strict";
import test from "node:test";

import {
  approveLayoutSession,
  LayoutApprovalProxyError,
} from "./approvalProxy.ts";

const environment = { LAYOUT_ORCHESTRATOR_URL: "http://orchestrator.test/" };

test("proxies a valid LangGraph approval and protects the session path", async () => {
  const result = await approveLayoutSession("session/1", "candidate_1", {
    environment,
    fetch: async (url, options) => {
      assert.equal(
        url,
        "http://orchestrator.test/v1/layout-sessions/session%2F1/approval",
      );
      assert.deepEqual(JSON.parse(options?.body ?? "{}"), {
        candidateId: "candidate_1",
      });
      return Response.json({
        session: { id: "session/1", status: "approved", engine: "langgraph" },
        candidate: { id: "candidate_1" },
      });
    },
  });

  assert.deepEqual(result, {
    session: { id: "session/1", status: "approved", engine: "langgraph" },
    candidateId: "candidate_1",
  });
});

test("normalizes FastAPI detail errors and marks upstream failures", async () => {
  await assert.rejects(
    () =>
      approveLayoutSession("session_1", "candidate_1", {
        environment,
        fetch: async () =>
          Response.json(
            { detail: { error: "Unknown candidate", issues: ["candidateId"] } },
            { status: 422 },
          ),
      }),
    (error) =>
      error instanceof LayoutApprovalProxyError &&
      error.status === 422 &&
      error.message === "Unknown candidate",
  );

  await assert.rejects(
    () =>
      approveLayoutSession("session_1", "candidate_1", {
        environment,
        fetch: async () => {
          throw new Error("connection refused");
        },
      }),
    (error) =>
      error instanceof LayoutApprovalProxyError &&
      error.status === 502 &&
      error.message === "Layout orchestrator is unavailable",
  );
});
