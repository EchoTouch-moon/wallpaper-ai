"""The resumable LangGraph workflow for constrained layout plans."""

from __future__ import annotations

from typing import Literal, Protocol

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from layout_orchestrator.contracts import (
    LayoutGenerationRequest,
    LayoutPlanCandidate,
    LayoutPlanResponse,
    SlotAssignment,
)
from layout_orchestrator.graph.nodes import validate_request
from layout_orchestrator.graph.state import LayoutGraphState


class LayoutPlanner(Protocol):
    """A model adapter returns only the constrained plan contract."""

    def __call__(self, request: LayoutGenerationRequest) -> LayoutPlanResponse: ...


def _template_slots(ratio_id: str) -> tuple[str, tuple[str, str, str]]:
    if ratio_id in {"9:16", "9:19.5"}:
        return "triptych_mobile_equal", ("top", "middle", "bottom")
    return "triptych_desktop_equal", ("left", "center", "right")


def deterministic_planner(request: LayoutGenerationRequest) -> LayoutPlanResponse:
    """Safe offline planner used in tests and when no model is configured.

    It intentionally selects an existing three-slot template and never emits
    canvas geometry, image bytes, URLs, or frontend-only data.
    """

    template_id, slot_ids = _template_slots(request.canvas.ratio_id)
    asset_ids = [asset.asset_id for asset in request.assets]
    candidates = [
        LayoutPlanCandidate(
            id=f"local_plan_{index + 1}",
            label=f"Editable triptych {index + 1}",
            reason="A constrained offline plan keeps every asset reference valid.",
            harmony_score=max(0.5, 0.86 - index * 0.04),
            template_id=template_id,
            assignments=[
                SlotAssignment(slot_id=slot_id, asset_id=asset_ids[position], crop=None)
                for position, slot_id in enumerate(slot_ids)
            ],
            background_color=None,
        )
        for index in range(request.requested_candidate_count())
    ]
    return LayoutPlanResponse(candidates=candidates)


def plan_layout(state: LayoutGraphState, planner: LayoutPlanner) -> LayoutGraphState:
    request = state["validated_request"]
    try:
        return {"plan": planner(request), "planning_errors": []}
    except Exception as error:  # Model adapters are isolated at this boundary.
        return {"planning_errors": [str(error)]}


def validate_plan(state: LayoutGraphState) -> LayoutGraphState:
    plan = state.get("plan")
    request = state["validated_request"]
    if plan is None:
        return {"planning_errors": ["Planner returned no layout plan"]}

    asset_ids = {asset.asset_id for asset in request.assets}
    template_id, expected_slots = _template_slots(request.canvas.ratio_id)
    errors: list[str] = []

    for candidate in plan.candidates:
        if candidate.template_id != template_id:
            errors.append(f"Unsupported template: {candidate.template_id}")
            continue
        assignments = {
            assignment.slot_id: assignment for assignment in candidate.assignments
        }
        if set(assignments) != set(expected_slots):
            errors.append(f"Invalid assignments for candidate: {candidate.id}")
            continue
        if any(
            assignment.asset_id not in asset_ids
            for assignment in assignments.values()
        ):
            errors.append(f"Unknown asset in candidate: {candidate.id}")

    return {"planning_errors": errors}


def await_approval(state: LayoutGraphState) -> LayoutGraphState:
    plan = state["plan"]
    selected_candidate_id = interrupt(
        {
            "kind": "layout_approval",
            "candidates": [
                candidate.model_dump(by_alias=True) for candidate in plan.candidates
            ],
        }
    )
    candidate_ids = {candidate.id for candidate in plan.candidates}
    if (
        not isinstance(selected_candidate_id, str)
        or selected_candidate_id not in candidate_ids
    ):
        return {
            "planning_errors": ["Approved candidate does not belong to this session"]
        }
    return {"selected_candidate_id": selected_candidate_id}


def after_validation(state: LayoutGraphState) -> Literal["plan_layout", "end"]:
    return "end" if state.get("validation_errors") else "plan_layout"


def after_planning(state: LayoutGraphState) -> Literal["validate_plan", "end"]:
    return "end" if state.get("planning_errors") else "validate_plan"


def after_plan_check(state: LayoutGraphState) -> Literal["await_approval", "end"]:
    return "end" if state.get("planning_errors") else "await_approval"


def build_layout_graph(
    planner: LayoutPlanner = deterministic_planner,
    checkpointer: BaseCheckpointSaver[str] | None = None,
) -> CompiledStateGraph[
    LayoutGraphState, None, LayoutGraphState, LayoutGraphState
]:
    """Compile the workflow with an injectable planner and checkpoint store."""

    builder = StateGraph(LayoutGraphState)
    builder.add_node("validate_request", validate_request)
    builder.add_node("plan_layout", lambda state: plan_layout(state, planner))
    builder.add_node("validate_plan", validate_plan)
    builder.add_node("await_approval", await_approval)
    builder.add_edge(START, "validate_request")
    builder.add_conditional_edges("validate_request", after_validation, {
        "plan_layout": "plan_layout",
        "end": END,
    })
    builder.add_conditional_edges("plan_layout", after_planning, {
        "validate_plan": "validate_plan",
        "end": END,
    })
    builder.add_conditional_edges("validate_plan", after_plan_check, {
        "await_approval": "await_approval",
        "end": END,
    })
    builder.add_edge("await_approval", END)
    return builder.compile(checkpointer=checkpointer or InMemorySaver())
