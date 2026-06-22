"""Registered template capabilities shared with the model-planning boundary."""

from __future__ import annotations

from dataclasses import dataclass

DESKTOP_RATIOS = frozenset({"16:9", "16:10", "21:9"})
MOBILE_RATIOS = frozenset({"9:16", "9:19.5"})


@dataclass(frozen=True)
class TemplateCapability:
    template_id: str
    template_type: str
    ratios: frozenset[str]
    slots: tuple[str, ...]


TEMPLATES = (
    TemplateCapability(
        "triptych_desktop_equal",
        "triptych",
        DESKTOP_RATIOS,
        ("left", "center", "right"),
    ),
    TemplateCapability(
        "triptych_desktop_editorial",
        "triptych",
        DESKTOP_RATIOS,
        ("hero", "support_top", "support_bottom"),
    ),
    TemplateCapability(
        "triptych_desktop_cinematic",
        "triptych",
        DESKTOP_RATIOS,
        ("left", "center", "right"),
    ),
    TemplateCapability(
        "layered_moodboard_desktop",
        "layered-moodboard",
        DESKTOP_RATIOS,
        ("background", "hero", "support_top", "support_bottom"),
    ),
    TemplateCapability(
        "irregular_collage_desktop",
        "irregular-collage",
        DESKTOP_RATIOS,
        ("hero", "support_top", "support_mid", "support_bottom"),
    ),
    TemplateCapability(
        "triptych_mobile_equal", "triptych", MOBILE_RATIOS, ("top", "middle", "bottom")
    ),
    TemplateCapability(
        "triptych_mobile_editorial",
        "triptych",
        MOBILE_RATIOS,
        ("hero", "support_left", "support_right"),
    ),
    TemplateCapability(
        "triptych_mobile_cinematic",
        "triptych",
        MOBILE_RATIOS,
        ("top", "middle", "bottom"),
    ),
    TemplateCapability(
        "portrait_triptych_mobile",
        "portrait-triptych",
        MOBILE_RATIOS,
        ("hero", "support_left", "support_right"),
    ),
    TemplateCapability(
        "layered_moodboard_mobile",
        "layered-moodboard",
        MOBILE_RATIOS,
        ("background", "hero", "support_top", "support_bottom"),
    ),
)

TEMPLATE_BY_ID = {template.template_id: template for template in TEMPLATES}


def compatible_templates(ratio_id: str, style: str) -> tuple[TemplateCapability, ...]:
    compatible = tuple(
        template for template in TEMPLATES if ratio_id in template.ratios
    )
    if style == "auto":
        return compatible
    style_type = "triptych" if style == "same-tone-triptych" else style
    return tuple(
        template for template in compatible if template.template_type == style_type
    )


def model_catalog(ratio_id: str) -> list[dict[str, object]]:
    return [
        {
            "id": template.template_id,
            "type": template.template_type,
            "slots": template.slots,
        }
        for template in compatible_templates(ratio_id, "auto")
    ]
