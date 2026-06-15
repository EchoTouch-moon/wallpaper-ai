# Layout Orchestrator Learning Service

This directory is an isolated Python 3.12 workspace for learning LangGraph
before the production orchestration migration begins.

## Setup

```bash
cd services/layout-orchestrator
uv sync
```

Commands do not require manual virtual environment activation:

```bash
uv run pytest
uv run ruff check .
uv run mypy
```

## Learning boundary

The scaffold intentionally contains no application graph. Lesson 1 asks you
to define the graph state and one request-validation node yourself. FastAPI,
model calls, retries, persistence, and the Next.js integration remain out of
scope until the foundations are understood.

Read [Lesson 1](LESSON_01.md) before adding files under
`src/layout_orchestrator/graph`.
