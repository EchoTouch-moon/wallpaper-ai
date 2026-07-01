from __future__ import annotations

from collections.abc import Iterator
from contextlib import AbstractContextManager
from unittest.mock import MagicMock

import pytest

from layout_orchestrator import checkpoint as checkpoint_module
from layout_orchestrator.checkpoint import open_checkpointer


class FakePostgresContext(AbstractContextManager[MagicMock]):
    """Mimics ``PostgresSaver.from_conn_string`` for resource-leak tests.

    Tracks every ``__enter__`` / ``__exit__`` call so a test can assert that no
    connection is left open when ``setup()`` raises.
    """

    def __init__(self, *, setup_raises: bool = False) -> None:
        self.saver = MagicMock(name="postgres_saver")
        self.setup_raises = setup_raises
        self.enter_count = 0
        self.exit_count = 0
        self.exit_args: tuple[object, ...] | None = None

    def __enter__(self) -> MagicMock:
        self.enter_count += 1
        if self.setup_raises:
            self.saver.setup.side_effect = RuntimeError("schema bootstrap failed")
        return self.saver

    def __exit__(self, *exc_info: object) -> None:
        self.exit_count += 1
        self.exit_args = exc_info


@pytest.fixture(autouse=True)
def _restore_postgres_saver() -> Iterator[None]:
    original = checkpoint_module.PostgresSaver  # type: ignore[attr-defined]
    yield
    checkpoint_module.PostgresSaver = original  # type: ignore[attr-defined]


def _patch_postgres(fake: FakePostgresContext) -> None:
    spec = checkpoint_module.PostgresSaver  # type: ignore[attr-defined]
    checkpoint_module.PostgresSaver = MagicMock(spec=spec)  # type: ignore[attr-defined]
    checkpoint_module.PostgresSaver.from_conn_string.return_value = fake  # type: ignore[attr-defined]


def test_postgres_close_releases_connection_on_normal_lifespan() -> None:
    fake = FakePostgresContext()
    _patch_postgres(fake)

    resource = open_checkpointer("postgresql://example.test/db")
    assert fake.enter_count == 1
    assert fake.exit_count == 0

    resource.close()
    assert fake.exit_count == 1


def test_postgres_setup_failure_releases_connection_without_leaking() -> None:
    fake = FakePostgresContext(setup_raises=True)
    _patch_postgres(fake)

    # setup() raises, so open_checkpointer must propagate the error AND make
    # sure __exit__ has already been called so the connection does not leak.
    with pytest.raises(RuntimeError, match="schema bootstrap failed"):
        open_checkpointer("postgresql://example.test/db")

    assert fake.enter_count == 1
    assert (
        fake.exit_count == 1
    ), "connection leaked: __exit__ never ran after setup failure"
