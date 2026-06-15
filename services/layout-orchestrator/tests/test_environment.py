import sys

from langgraph.graph import StateGraph


def test_uses_python_312() -> None:
    assert sys.version_info[:2] == (3, 12)


def test_langgraph_is_importable() -> None:
    assert callable(StateGraph)
