"""Pure graph nodes. HTTP and model concerns stay outside these functions."""

from __future__ import annotations

from pydantic import ValidationError

from layout_orchestrator.contracts import LayoutGenerationRequest, validation_messages
from layout_orchestrator.graph.state import LayoutGraphState

_UNSUPPORTED_FIELDS = {
    "base64": "Raw image data must not be sent to the layout API.",
    "dataUrl": "Image data URLs must not be sent to the layout API.",
    "fabric": "Fabric objects belong to the frontend rendering layer.",
    "fabricObject": "Fabric objects belong to the frontend rendering layer.",
    "file": "Image files must not be sent to the layout API.",
    "objectUrl": "Browser object URLs must not be sent to the layout API.",
    "previewUrl": "Preview URLs belong to the frontend rendering layer.",
    "thumbnailUrl": "Thumbnail URLs belong to the frontend rendering layer.",
}


def _unsupported_fields(value: object, path: tuple[str | int, ...] = ()) -> list[str]:
    if isinstance(value, list):
        return [
            issue
            for index, item in enumerate(value)
            for issue in _unsupported_fields(item, (*path, index))
        ]
    if not isinstance(value, dict):
        return []

    issues: list[str] = []
    for key, nested_value in value.items():
        nested_path = (*path, key)
        if key in _UNSUPPORTED_FIELDS:
            joined_path = ".".join(str(part) for part in nested_path)
            issues.append(f"{joined_path}: {_UNSUPPORTED_FIELDS[key]}")
        issues.extend(_unsupported_fields(nested_value, nested_path))
    return issues


def validate_request(state: LayoutGraphState) -> LayoutGraphState:
    """Validate user input into a typed request without mutating graph state."""

    request = state.get("request")
    if request is None:
        return {"validation_errors": ["request: Field required"]}

    unsupported_issues = _unsupported_fields(request)
    if unsupported_issues:
        return {"validation_errors": unsupported_issues}

    try:
        validated = LayoutGenerationRequest.model_validate(request)
    except ValidationError as error:
        return {"validation_errors": validation_messages(error)}

    return {"validated_request": validated, "validation_errors": []}
