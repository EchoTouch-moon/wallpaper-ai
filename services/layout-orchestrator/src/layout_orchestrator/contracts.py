"""Version 1 request and constrained-plan contracts shared at the service edge.

The browser-facing API remains owned by the existing TypeScript Zod schemas.
These Pydantic models deliberately mirror the wire format so the Python
orchestrator can reject malformed or privacy-sensitive input before it enters
the graph.
"""

from __future__ import annotations

from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """Strict camelCase JSON model used by the Next.js BFF boundary."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class NormalizedPoint(ApiModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class NormalizedBox(ApiModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def remains_inside_container(self) -> NormalizedBox:
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Normalized box must remain inside its container")
        return self


class Canvas(ApiModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    ratio_id: Literal["16:9", "16:10", "21:9", "9:16", "9:19.5"]


class LayoutIntent(ApiModel):
    mode: Literal["template", "mock-ai", "ai"]
    style: Literal[
        "same-tone-triptych",
        "layered-moodboard",
        "portrait-triptych",
        "irregular-collage",
        "auto",
    ]
    composition_intent: Literal[
        "single-hero",
        "hero-with-support",
        "balanced-collage",
        "story-strip",
    ] | None = None
    safe_area: Literal[
        "none",
        "desktop-left",
        "mobile-top",
        "desktop-bottom",
    ] | None = None
    count: int | None = Field(default=None, gt=0, le=8)
    user_prompt: str | None = Field(default=None, max_length=1200)


class ImageAssetAnalysis(ApiModel):
    asset_id: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    orientation: Literal["portrait", "landscape", "square"]
    aspect_ratio: float = Field(gt=0)
    resolution_score: float = Field(ge=0, le=1)
    dominant_colors: list[str] = Field(min_length=3, max_length=3)
    average_color: str
    brightness: float = Field(ge=0, le=1)
    saturation: float = Field(ge=0, le=1)
    contrast: float = Field(ge=0, le=1)
    content_type: Literal[
        "portrait",
        "landscape",
        "anime",
        "pet",
        "architecture",
        "object",
        "text-heavy",
        "unknown",
    ] | None = None
    faces: list[NormalizedBox] | None = None
    subject_box: NormalizedBox | None = None
    saliency_center: NormalizedPoint | None = None
    style_tags: list[str] | None = None
    best_use: list[
        Literal[
            "hero",
            "background",
            "support",
            "triptych",
            "portrait-collage",
            "irregular-collage",
        ]
    ] | None = None
    crop_safety: Literal["high", "medium", "low"] | None = None

    @field_validator("dominant_colors", "average_color")
    @classmethod
    def has_hex_colors(cls, value: list[str] | str) -> list[str] | str:
        colors = value if isinstance(value, list) else [value]
        if any(not color.startswith("#") or len(color) != 7 for color in colors):
            raise ValueError("Colors must be six-digit hex values")
        return value


class GenerationOptions(ApiModel):
    candidate_count: int | None = Field(default=None, gt=0, le=8)
    allow_fallback: bool | None = None
    strict_validation: bool | None = None


class LayoutGenerationRequest(ApiModel):
    operation: Literal["generate", "refine"] = "generate"
    canvas: Canvas
    intent: LayoutIntent
    assets: list[ImageAssetAnalysis] = Field(min_length=3)
    current_layout: dict[str, object] | None = None
    options: GenerationOptions | None = None

    @model_validator(mode="after")
    def validates_cross_field_constraints(self) -> LayoutGenerationRequest:
        asset_ids = [asset.asset_id for asset in self.assets]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("Duplicate analyzed asset id")
        if self.operation == "refine":
            if self.current_layout is None:
                raise ValueError("Refine requests require the current layout")
            if not self.intent.user_prompt or not self.intent.user_prompt.strip():
                raise ValueError("Refine requests require a user prompt")
        return self

    def requested_candidate_count(self) -> int:
        if self.operation == "refine":
            return 1
        if self.options and self.options.candidate_count:
            return self.options.candidate_count
        return self.intent.count or 3


class CropPlan(ApiModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    focal_point: NormalizedPoint | None

    @model_validator(mode="after")
    def remains_inside_container(self) -> CropPlan:
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Normalized box must remain inside its container")
        return self


class SlotAssignment(ApiModel):
    slot_id: str = Field(min_length=1)
    asset_id: str = Field(min_length=1)
    crop: CropPlan | None


class LayoutPlanCandidate(ApiModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1, max_length=80)
    reason: str = Field(min_length=1, max_length=500)
    harmony_score: float = Field(ge=0, le=1)
    template_id: str = Field(min_length=1)
    assignments: list[SlotAssignment] = Field(min_length=1)
    background_color: str | None

    @model_validator(mode="after")
    def has_unique_slots(self) -> LayoutPlanCandidate:
        slot_ids = [assignment.slot_id for assignment in self.assignments]
        if len(slot_ids) != len(set(slot_ids)):
            raise ValueError("Duplicate slot assignment")
        return self


class LayoutPlanResponse(ApiModel):
    candidates: list[LayoutPlanCandidate] = Field(min_length=1, max_length=8)


def validation_messages(error: Exception) -> list[str]:
    """Render Pydantic errors without exposing implementation details."""

    if not hasattr(error, "errors"):
        return [str(error)]
    details = error.errors()
    return [
        f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}"
        for item in details
    ]
