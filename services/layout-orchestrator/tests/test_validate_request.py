from __future__ import annotations

from copy import deepcopy

from layout_orchestrator.graph.nodes import validate_request
from layout_orchestrator.graph.state import LayoutGraphState


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


def test_validate_request_returns_typed_request_without_mutating_state() -> None:
    state: LayoutGraphState = {"request": request()}
    original = deepcopy(state)

    update = validate_request(state)

    assert update["validation_errors"] == []
    assert update["validated_request"].canvas.ratio_id == "16:9"
    assert state == original


def test_validate_request_reports_missing_canvas() -> None:
    invalid = request()
    invalid.pop("canvas")

    update = validate_request({"request": invalid})

    assert update["validation_errors"]
    assert any(message.startswith("canvas:") for message in update["validation_errors"])
    assert "validated_request" not in update


def test_validate_request_reports_too_few_assets() -> None:
    invalid = request()
    invalid["assets"] = [analysis("asset_a"), analysis("asset_b")]

    update = validate_request({"request": invalid})

    assert any("assets:" in message for message in update["validation_errors"])


def test_validate_request_rejects_browser_only_fields_recursively() -> None:
    invalid = request()
    assets = invalid["assets"]
    assert isinstance(assets, list)
    assets[0]["objectUrl"] = "blob:http://localhost/image"

    update = validate_request({"request": invalid})

    assert update["validation_errors"] == [
        "assets.0.objectUrl: Browser object URLs must not be sent to the layout API."
    ]
