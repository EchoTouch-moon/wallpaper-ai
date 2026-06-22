"""OpenAI-compatible structured planner, configured like the learning project."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Protocol, cast

from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from layout_orchestrator.contracts import LayoutGenerationRequest, LayoutPlanResponse
from layout_orchestrator.templates import model_catalog


class StructuredModel(Protocol):
    def invoke(self, input: list[dict[str, str]]) -> object: ...


@dataclass(frozen=True)
class ModelSettings:
    api_key: str
    base_url: str
    model: str
    timeout_seconds: float

    @classmethod
    def from_environment(
        cls, environment: dict[str, str] | None = None
    ) -> ModelSettings | None:
        values = environment if environment is not None else os.environ
        api_key = values.get("LLM_API_KEY") or values.get("DASHSCOPE_API_KEY")
        base_url = values.get("LLM_BASE_URL") or values.get("DASHSCOPE_BASE_URL")
        if not api_key or not base_url:
            return None
        model = (
            values.get("LLM_MODEL")
            or values.get("DASHSCOPE_MODEL")
            or "deepseek-v4-flash"
        )
        timeout_ms = int(values.get("LLM_TIMEOUT_MS", "30000"))
        return cls(api_key, base_url, model, timeout_ms / 1000)


class ChatOpenAILayoutPlanner:
    def __init__(
        self, settings: ModelSettings, structured_model: StructuredModel | None = None
    ) -> None:
        self._model = structured_model or cast(
            StructuredModel,
            ChatOpenAI(
                model=settings.model,
                api_key=SecretStr(settings.api_key),
                base_url=settings.base_url,
                timeout=settings.timeout_seconds,
                max_retries=0,
            ).with_structured_output(LayoutPlanResponse),
        )

    def __call__(self, request: LayoutGenerationRequest) -> LayoutPlanResponse:
        count = request.requested_candidate_count()
        messages = [
            {
                "role": "system",
                "content": (
                    "You plan editable photo wallpapers. Return only the constrained "
                    "structured schema. Use only supplied template IDs, slot IDs, and "
                    "asset IDs. Assign every slot exactly once. Never create canvas "
                    "coordinates, image URLs, image data, Fabric objects, or polygons."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "operation": request.operation,
                        "candidateCount": count,
                        "intent": request.intent.model_dump(by_alias=True),
                        "canvas": request.canvas.model_dump(by_alias=True),
                        "assets": [
                            asset.model_dump(by_alias=True) for asset in request.assets
                        ],
                        "templates": model_catalog(request.canvas.ratio_id),
                        "currentLayout": request.current_layout,
                    }
                ),
            },
        ]
        response = self._model.invoke(messages)
        if isinstance(response, LayoutPlanResponse):
            return response
        return LayoutPlanResponse.model_validate(response)


def create_runtime_planner() -> ChatOpenAILayoutPlanner | None:
    settings = ModelSettings.from_environment()
    return ChatOpenAILayoutPlanner(settings) if settings else None
