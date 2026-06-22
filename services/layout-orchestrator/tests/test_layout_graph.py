from __future__ import annotations

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from layout_orchestrator.graph.state import LayoutGraphState
from layout_orchestrator.graph.workflow import build_layout_graph


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
        "options": {"candidateCount": 2},
    }


def test_graph_interrupts_with_constrained_candidates_and_resumes() -> None:
    graph = build_layout_graph()
    config: RunnableConfig = {"configurable": {"thread_id": "layout-session-1"}}
    initial_state: LayoutGraphState = {"request": request()}

    paused = graph.invoke(initial_state, config=config)

    interrupt_value = paused["__interrupt__"][0].value
    assert interrupt_value["kind"] == "layout_approval"
    assert len(interrupt_value["candidates"]) == 2
    assert interrupt_value["candidates"][0]["templateId"] == "triptych_desktop_equal"

    approval: Command[str] = Command(resume="local_plan_2")
    completed = graph.invoke(approval, config=config)

    assert completed["selected_candidate_id"] == "local_plan_2"
    assert completed["planning_errors"] == []


def test_graph_returns_validation_errors_without_invoking_approval() -> None:
    graph = build_layout_graph()
    invalid_state: LayoutGraphState = {
        "request": {"canvas": {}, "intent": {}, "assets": []}
    }
    config: RunnableConfig = {"configurable": {"thread_id": "invalid-session"}}
    result = graph.invoke(invalid_state, config=config)

    assert result["validation_errors"]
    assert "__interrupt__" not in result
