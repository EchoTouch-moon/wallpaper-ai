# Lesson 1: State and Request Validation

## Goal

Build the smallest useful part of the future layout graph:

```text
input request -> validate_request node -> validated request or validation errors
```

Do not compile a `StateGraph` or call a model in this lesson.

## Your implementation

Create these files:

```text
src/layout_orchestrator/graph/state.py
src/layout_orchestrator/graph/nodes.py
tests/test_validate_request.py
```

### 1. Define the state

Create a `LayoutGraphState` using `TypedDict` with optional fields:

- `request: dict[str, object]`
- `validated_request: dict[str, object]`
- `validation_errors: list[str]`

Think about why graph state fields are optional while the graph is running.

### 2. Write `validate_request`

The node receives `LayoutGraphState` and returns a partial state update.

For this first exercise, a valid request must:

- contain a `canvas` dictionary;
- contain an `assets` list with at least three entries;
- contain an `intent` dictionary.

On success:

- return `validated_request`;
- return an empty `validation_errors` list.

On failure:

- do not raise an exception;
- return one readable error string for every missing or invalid field;
- do not return `validated_request`.

The node must not mutate the input state.

### 3. Write tests

Add at least:

- one valid request test;
- one request missing `canvas` test;
- one request with fewer than three assets test;
- one test proving the original state was not mutated.

## Completion checks

```bash
uv run pytest
uv run ruff check .
uv run mypy
```

When they pass, ask Codex for review before creating the lesson commit.

## Review questions

Be ready to explain:

1. Which fields does the node read?
2. Which fields does it write?
3. Why are validation failures stored in state instead of raised?
4. Why should a node return a partial update?
