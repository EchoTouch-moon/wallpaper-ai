"""Cross-language contract parity between Pydantic and the Zod schemas.

The Python orchestrator and the Next.js BFF each own a hand-maintained mirror
of the layout contract (Pydantic in ``contracts.py``, Zod in
``lib/layout-generation``). When one side evolves and the other is forgotten,
requests/responses start to be accepted by one layer and rejected by the
other. These tests feed the *same* camelCase JSON fixture to both validators
and assert they always agree.

The Zod side is driven through ``scripts/validate-contract.mjs`` (a tiny stdin
CLI), so the comparison runs against the real runtime schema rather than a
stale snapshot.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from layout_orchestrator.contracts import LayoutGenerationRequest, LayoutPlanResponse

# The repo root (where ``scripts/`` and ``lib/`` live) sits two levels above
# this service's directory.
REPO_ROOT = Path(__file__).resolve().parents[3]
VALIDATOR = REPO_ROOT / "scripts" / "validate-contract.mjs"


# ---------------------------------------------------------------------------
# Known asymmetries (documented, not asserted against here)
# ---------------------------------------------------------------------------
# 1. ``imageAssetAnalysisSchema`` (Zod) is NOT ``.strict()``, while its Pydantic
#    twin ``ImageAssetAnalysis`` inherits ``extra="forbid"``. A payload carrying
#    an unknown field *inside an asset* is accepted by Zod but rejected by
#    Pydantic. We avoid an asset-level unknown-field case below; fixing this is
#    tracked separately.
# 2. ``currentLayout``: frontend enforces a strict ``wallpaperLayoutSchema``,
#    backend treats it as a loose ``dict[str, object] | None``. The refine
#    cases below assert the cross-field *requirement* (must be present), not the
#    structure, so this drift does not interfere.
# Every other container (canvas, intent, options, top-level request, plan
# response) is strict on both sides.


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

def _asset(asset_id: str) -> dict[str, object]:
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


def _valid_request() -> dict[str, object]:
    return {
        "canvas": {"width": 1920, "height": 1080, "ratioId": "16:9"},
        "intent": {"mode": "ai", "style": "auto"},
        "assets": [_asset("asset_a"), _asset("asset_b"), _asset("asset_c")],
    }


def _assignment(slot_id: str, asset_id: str) -> dict[str, object]:
    return {"slotId": slot_id, "assetId": asset_id, "crop": None}


def _valid_response() -> dict[str, object]:
    return {
        "candidates": [
            {
                "id": "plan_1",
                "label": "Balanced triptych",
                "reason": "Cool palette across all assets.",
                "harmonyScore": 0.9,
                "templateId": "triptych_desktop_equal",
                "assignments": [
                    _assignment("left", "asset_a"),
                    _assignment("center", "asset_b"),
                    _assignment("right", "asset_c"),
                ],
                "backgroundColor": None,
            }
        ]
    }


# ---------------------------------------------------------------------------
# Validator helpers
# ---------------------------------------------------------------------------

def _python_validates(model: type[object], payload: object) -> bool:
    try:
        model.model_validate(payload)  # type: ignore[attr-defined]
    except Exception:
        return False
    return True


def _node_available() -> bool:
    return shutil.which("node") is not None


def _node_validates(kind: str, payload: object) -> bool:
    """Run the Zod validator in Node and return whether it accepted payload."""
    envelope = json.dumps({"kind": kind, "payload": payload})
    completed = subprocess.run(
        ["node", "--experimental-strip-types", str(VALIDATOR)],
        input=envelope,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
        timeout=20,
    )
    result = json.loads(completed.stdout)
    return bool(result.get("ok"))


# Skip the whole module when Node is not installed (e.g. a pure-Python CI image)
# so it never blocks backend-only test runs.
pytestmark = pytest.mark.skipif(not _node_available(), reason="node not found")


# ---------------------------------------------------------------------------
# Request contract: generateLayoutRequestSchema <-> LayoutGenerationRequest
# ---------------------------------------------------------------------------

REQUEST_CASES: list[tuple[str, dict[str, object], bool]] = [
    ("valid generate", _valid_request(), True),
    (
        "valid with candidate count",
        {**_valid_request(), "options": {"candidateCount": 3}},
        True,
    ),
    (
        "valid with candidate count",
        {**_valid_request(), "options": {"candidateCount": 3}},
        True,
    ),
    (
        # refine requires currentLayout + userPrompt on both sides. We test the
        # *absence* of those rather than a valid currentLayout because the two
        # sides disagree on currentLayout's shape (frontend is a strict
        # wallpaperLayoutSchema, backend is a loose dict) — that is a separate,
        # documented drift we do not assert against here.
        "refine without current layout is rejected",
        {
            **_valid_request(),
            "operation": "refine",
            "intent": {
                "mode": "ai",
                "style": "auto",
                "userPrompt": "make the hero larger",
            },
        },
        False,
    ),
    (
        "refine without user prompt is rejected",
        {
            **_valid_request(),
            "operation": "refine",
            "currentLayout": {"version": "1.0"},
        },
        False,
    ),
    ("defaults operation when omitted", _valid_request(), True),
    ("rejects fewer than three assets", {**_valid_request(), "assets": []}, False),
    (
        "rejects unknown canvas field",
        {
            **_valid_request(),
            "canvas": {"width": 1920, "height": 1080, "ratioId": "16:9", "extra": 1},
        },
        False,
    ),
    (
        "rejects invalid ratio id",
        {
            **_valid_request(),
            "canvas": {"width": 1920, "height": 1080, "ratioId": "4:3"},
        },
        False,
    ),
    (
        "rejects duplicate asset ids",
        {
            **_valid_request(),
            "assets": [_asset("dup"), _asset("dup"), _asset("asset_c")],
        },
        False,
    ),
    (
        "rejects intent count over eight",
        {**_valid_request(), "intent": {"mode": "ai", "style": "auto", "count": 9}},
        False,
    ),
    (
        "rejects oversized user prompt",
        {
            **_valid_request(),
            "intent": {
                "mode": "ai",
                "style": "auto",
                "userPrompt": "x" * 1201,
            },
        },
        False,
    ),
]


@pytest.mark.parametrize(
    ("name", "payload", "expected"),
    REQUEST_CASES,
    ids=[case[0] for case in REQUEST_CASES],
)
def test_request_contract_parity(
    name: str,  # noqa: ARG001 - used as the parametrized id
    payload: dict[str, object],
    expected: bool,
) -> None:
    python_ok = _python_validates(LayoutGenerationRequest, payload)
    node_ok = _node_validates("request", payload)

    assert python_ok == expected, (
        f"Pydantic mismatch for {name!r}: expected {expected}, got {python_ok}"
    )
    assert node_ok == expected, (
        f"Zod mismatch for {name!r}: expected {expected}, got {node_ok}"
    )


# ---------------------------------------------------------------------------
# Response contract: aiLayoutPlanResponseSchema <-> LayoutPlanResponse
# ---------------------------------------------------------------------------

RESPONSE_CASES: list[tuple[str, dict[str, object], bool]] = [
    ("valid plan", _valid_response(), True),
    ("rejects empty candidates", {"candidates": []}, False),
    (
        "rejects harmony score over one",
        {
            "candidates": [
                {
                    **_valid_response()["candidates"][0],  # type: ignore[index]
                    "harmonyScore": 1.5,
                }
            ]
        },
        False,
    ),
    (
        "rejects duplicate slot assignments",
        {
            "candidates": [
                {
                    **_valid_response()["candidates"][0],  # type: ignore[index]
                    "assignments": [
                        _assignment("left", "asset_a"),
                        _assignment("left", "asset_b"),
                        _assignment("right", "asset_c"),
                    ],
                }
            ]
        },
        False,
    ),
    (
        "rejects oversized label",
        {
            "candidates": [
                {
                    **_valid_response()["candidates"][0],  # type: ignore[index]
                    "label": "x" * 81,
                }
            ]
        },
        False,
    ),
    (
        "rejects unknown candidate field",
        {
            "candidates": [
                {
                    **_valid_response()["candidates"][0],  # type: ignore[index]
                    "surprise": True,
                }
            ]
        },
        False,
    ),
]


@pytest.mark.parametrize(
    ("name", "payload", "expected"),
    RESPONSE_CASES,
    ids=[case[0] for case in RESPONSE_CASES],
)
def test_response_contract_parity(
    name: str,  # noqa: ARG001
    payload: dict[str, object],
    expected: bool,
) -> None:
    python_ok = _python_validates(LayoutPlanResponse, payload)
    node_ok = _node_validates("response", payload)

    assert python_ok == expected, (
        f"Pydantic mismatch for {name!r}: expected {expected}, got {python_ok}"
    )
    assert node_ok == expected, (
        f"Zod mismatch for {name!r}: expected {expected}, got {node_ok}"
    )
