from __future__ import annotations

from layout_orchestrator.contracts import LayoutGenerationRequest
from layout_orchestrator.model import ChatOpenAILayoutPlanner, ModelSettings


class FakeStructuredModel:
    def __init__(self) -> None:
        self.messages: list[dict[str, str]] = []

    def invoke(self, input: list[dict[str, str]]) -> object:
        self.messages = input
        return {
            "candidates": [
                {
                    "id": "model_1",
                    "label": "Model plan",
                    "reason": "A structured model response.",
                    "harmonyScore": 0.8,
                    "templateId": "triptych_desktop_equal",
                    "assignments": [
                        {"slotId": "left", "assetId": "asset_a", "crop": None},
                        {"slotId": "center", "assetId": "asset_b", "crop": None},
                        {"slotId": "right", "assetId": "asset_c", "crop": None},
                    ],
                    "backgroundColor": None,
                }
            ]
        }


def request() -> LayoutGenerationRequest:
    analysis = {
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
    return LayoutGenerationRequest.model_validate(
        {
            "canvas": {"width": 1920, "height": 1080, "ratioId": "16:9"},
            "intent": {"mode": "ai", "style": "auto"},
            "assets": [
                {"assetId": "asset_a", **analysis},
                {"assetId": "asset_b", **analysis},
                {"assetId": "asset_c", **analysis},
            ],
        }
    )


def test_model_settings_accepts_learning_project_environment() -> None:
    settings = ModelSettings.from_environment(
        {
            "DASHSCOPE_API_KEY": "test-key",
            "DASHSCOPE_BASE_URL": "https://example.test/v1",
        }
    )

    assert settings is not None
    assert settings.model == "deepseek-v4-flash"
    assert settings.timeout_seconds == 30


def test_structured_planner_sends_only_constrained_metadata() -> None:
    model = FakeStructuredModel()
    planner = ChatOpenAILayoutPlanner(
        ModelSettings("test-key", "https://example.test/v1", "test-model", 30),
        structured_model=model,
    )

    result = planner(request())

    assert result.candidates[0].id == "model_1"
    assert "triptych_desktop_equal" in model.messages[1]["content"]
    assert "Fabric" not in model.messages[1]["content"]
