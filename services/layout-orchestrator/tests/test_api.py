from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from layout_orchestrator.api import create_app
from layout_orchestrator.contracts import LayoutGenerationRequest
from layout_orchestrator.graph.state import LayoutGraphState
from layout_orchestrator.graph.workflow import deterministic_planner


def analysis(asset_id: str) -> dict[str, object]:
    return {
        "assetId": asset_id,
        "width": 1920,
        "height": 1080,
        "orientation": "landscape",
        "aspectRatio": 1920 / 1080,
        "resolutionScore": 0.8,
        "dominantColors": ["#456fd6", "#456fd6", "#456fd6"],
        "averageColor": "#456fd6",
        "brightness": 0.5,
        "saturation": 0.5,
        "contrast": 0.4,
    }


def request() -> dict[str, object]:
    return {
        "canvas": {"width": 1920, "height": 1080, "ratioId": "16:9"},
        "intent": {"mode": "ai", "style": "auto"},
        "assets": [analysis("asset_a"), analysis("asset_b"), analysis("asset_c")],
    }


def test_health_and_readiness_endpoints() -> None:
    with TestClient(create_app()) as client:
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/readyz").json() == {"status": "ready"}


def test_session_returns_plan_then_approves_candidate() -> None:
    with TestClient(create_app()) as client:
        start = client.post("/v1/layout-sessions", json=request())

        assert start.status_code == 200
        body = start.json()
        assert body["session"]["status"] == "awaiting_approval"
        assert body["session"]["engine"] == "langgraph"
        candidate_id = body["plan"]["candidates"][0]["id"]

        approval = client.post(
            f"/v1/layout-sessions/{body['session']['id']}/approval",
            json={"candidateId": candidate_id},
        )

        assert approval.status_code == 200
        assert approval.json()["session"]["status"] == "approved"
        assert approval.json()["candidate"]["id"] == candidate_id


def test_sqlite_checkpoint_resumes_after_app_restart(tmp_path: Path) -> None:
    checkpoint_path = str(tmp_path / "layout-checkpoints.sqlite3")
    with TestClient(create_app(checkpoint_path=checkpoint_path)) as first_client:
        start = first_client.post("/v1/layout-sessions", json=request())
        body = start.json()
        candidate_id = body["plan"]["candidates"][0]["id"]

    with TestClient(create_app(checkpoint_path=checkpoint_path)) as restarted_client:
        approval = restarted_client.post(
            f"/v1/layout-sessions/{body['session']['id']}/approval",
            json={"candidateId": candidate_id},
        )

    assert approval.status_code == 200
    assert approval.json()["candidate"]["id"] == candidate_id


def test_session_rejects_invalid_request_before_creating_graph_run() -> None:
    with TestClient(create_app()) as client:
        response = client.post(
            "/v1/layout-sessions",
            json={"canvas": {}, "intent": {}, "assets": []},
        )

        assert response.status_code == 400
        assert response.json()["detail"]["error"] == "Invalid generate-layout request"


def _validated_request() -> LayoutGenerationRequest:
    return LayoutGenerationRequest.model_validate(request())


def test_approval_returns_500_when_selected_candidate_is_missing_from_plan() -> None:
    # Simulate a corrupted graph state where selected_candidate_id points at a
    # candidate that does not exist in the plan. The API must surface a clear
    # 500 instead of letting next() raise StopIteration (opaque 500 / framework
    # quirk).
    plan = deterministic_planner(_validated_request())
    corrupted_state: LayoutGraphState = {
        "plan": plan,
        "selected_candidate_id": "does_not_exist",
    }
    fake_graph: Any = MagicMock()
    fake_graph.invoke.return_value = corrupted_state

    with TestClient(create_app(graph=fake_graph)) as client:
        response = client.post(
            "/v1/layout-sessions/any-session/approval",
            json={"candidateId": "does_not_exist"},
        )

    assert response.status_code == 500
    assert (
        response.json()["detail"]["error"]
        == "Approved candidate is missing from the layout plan"
    )
