"""State carried through the wallpaper layout orchestration graph."""

from __future__ import annotations

from typing import TypedDict

from layout_orchestrator.contracts import LayoutGenerationRequest, LayoutPlanResponse


class LayoutGraphState(TypedDict, total=False):
    """A node writes only the fields it owns; reducers merge partial updates."""

    request: dict[str, object]
    validated_request: LayoutGenerationRequest
    validation_errors: list[str]
    plan: LayoutPlanResponse
    planning_errors: list[str]
    selected_candidate_id: str
