"""FastAPI boundary for the resumable layout-orchestration graph."""

from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, status
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command
from pydantic import BaseModel, ConfigDict, Field

from layout_orchestrator.checkpoint import create_sqlite_checkpointer
from layout_orchestrator.contracts import LayoutPlanCandidate, LayoutPlanResponse
from layout_orchestrator.graph.state import LayoutGraphState
from layout_orchestrator.graph.workflow import build_layout_graph, deterministic_planner
from layout_orchestrator.model import create_runtime_planner

LayoutGraph = CompiledStateGraph[
    LayoutGraphState, None, LayoutGraphState, LayoutGraphState
]


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(min_length=1, alias="candidateId")


class SessionDetails(BaseModel):
    id: str
    status: str
    engine: str = "langgraph"


class SessionStartResponse(BaseModel):
    session: SessionDetails
    plan: LayoutPlanResponse


class SessionApprovalResponse(BaseModel):
    session: SessionDetails
    candidate: LayoutPlanCandidate


def _config(session_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": session_id}}


def _invalid_request(errors: list[str]) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"error": "Invalid generate-layout request", "issues": errors},
    )


def _failed_plan(errors: list[str]) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"error": "Layout generation failed", "issues": errors},
    )


def _plan_from_state(state: LayoutGraphState) -> LayoutPlanResponse:
    plan = state.get("plan")
    if plan is None:
        raise _failed_plan(["Graph completed without a layout plan"])
    return plan


def create_app(
    graph: LayoutGraph | None = None,
    checkpoint_path: str = ":memory:",
) -> FastAPI:
    app = FastAPI(title="Wallpaper Layout Orchestrator", version="0.1.0")
    app.state.layout_graph = graph or build_layout_graph(
        planner=create_runtime_planner() or deterministic_planner,
        checkpointer=create_sqlite_checkpointer(checkpoint_path),
    )

    @app.get("/healthz")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def ready() -> dict[str, str]:
        return {"status": "ready"}

    @app.post("/v1/layout-sessions", response_model=SessionStartResponse)
    async def start_layout_session(request: Request) -> SessionStartResponse:
        try:
            body = await request.json()
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "Invalid JSON body", "issues": [str(error)]},
            ) from error
        if not isinstance(body, dict):
            raise _invalid_request(["body: Request body must be a JSON object"])

        session_id = str(uuid4())
        initial_state: LayoutGraphState = {"request": body}
        result = app.state.layout_graph.invoke(
            initial_state,
            config=_config(session_id),
        )
        if result.get("validation_errors"):
            raise _invalid_request(result["validation_errors"])
        if result.get("planning_errors"):
            raise _failed_plan(result["planning_errors"])

        return SessionStartResponse(
            session=SessionDetails(id=session_id, status="awaiting_approval"),
            plan=_plan_from_state(result),
        )

    @app.post(
        "/v1/layout-sessions/{session_id}/approval",
        response_model=SessionApprovalResponse,
    )
    def approve_layout_session(
        session_id: str,
        approval: ApprovalRequest,
    ) -> SessionApprovalResponse:
        result = app.state.layout_graph.invoke(
            Command(resume=approval.candidate_id),
            config=_config(session_id),
        )
        if result.get("planning_errors"):
            raise _failed_plan(result["planning_errors"])
        selected_candidate_id = result.get("selected_candidate_id")
        if selected_candidate_id is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": "Layout session was not found or is not awaiting approval"
                },
            )

        plan = _plan_from_state(result)
        candidate = next(
            item for item in plan.candidates if item.id == selected_candidate_id
        )
        return SessionApprovalResponse(
            session=SessionDetails(id=session_id, status="approved"),
            candidate=candidate,
        )

    return app


app = create_app(checkpoint_path=".local/layout-checkpoints.sqlite3")
