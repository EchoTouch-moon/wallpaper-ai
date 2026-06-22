import assert from "node:assert/strict";
import test from "node:test";

import {
  approveLangGraphSession,
  startLangGraphSession,
} from "./langgraphOrchestrator.ts";

const request = {
  canvas: { width: 1920, height: 1080, ratioId: "16:9" },
  intent: { mode: "ai", style: "auto" },
  assets: [],
};

const candidate = {
  id: "plan_1",
  label: "Triptych",
  reason: "Test candidate",
  harmonyScore: 0.8,
  templateId: "triptych_desktop_equal",
  assignments: [
    { slotId: "left", assetId: "asset_a", crop: null },
    { slotId: "center", assetId: "asset_b", crop: null },
    { slotId: "right", assetId: "asset_c", crop: null },
  ],
  backgroundColor: null,
};

const environment = { LAYOUT_ORCHESTRATOR_URL: "http://orchestrator.test" };

test("starts a LangGraph session and validates its constrained plan", async () => {
  const calls = [];
  const result = await startLangGraphSession(request, {
    environment,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json({
        session: {
          id: "session_1",
          status: "awaiting_approval",
          engine: "langgraph",
        },
        plan: { candidates: [candidate] },
      });
    },
  });

  assert.equal(calls[0].url, "http://orchestrator.test/v1/layout-sessions");
  assert.equal(result.plan.candidates[0].id, "plan_1");
});

test("approves a candidate through the session endpoint", async () => {
  const result = await approveLangGraphSession("session_1", "plan_1", {
    environment,
    fetch: async (url, options) => {
      assert.equal(
        url,
        "http://orchestrator.test/v1/layout-sessions/session_1/approval",
      );
      assert.equal(options.method, "POST");
      return Response.json({
        session: { id: "session_1", status: "approved", engine: "langgraph" },
        candidate,
      });
    },
  });

  assert.equal(result.candidate.id, "plan_1");
});
