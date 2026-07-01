"""Local durable checkpoint configuration for LangGraph sessions."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.checkpoint.sqlite import SqliteSaver


@dataclass
class CheckpointResource:
    saver: BaseCheckpointSaver[str]
    close: Callable[[], None]


def create_sqlite_checkpointer(database_path: str) -> SqliteSaver:
    """Create and initialize a thread-safe SQLite checkpoint saver.

    ``:memory:`` remains useful for isolated unit tests. File paths are created
    on demand and allow a FastAPI restart to resume an approval interrupt.
    """

    if database_path != ":memory:":
        Path(database_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, check_same_thread=False)
    saver = SqliteSaver(connection)
    saver.setup()
    return saver


def open_checkpointer(database_url: str) -> CheckpointResource:
    """Open SQLite or PostgreSQL checkpoint storage for the app lifespan.

    ``PostgresSaver.from_conn_string`` returns a context manager whose
    connection is only released by ``__exit__``. If ``setup()`` raises before
    we hand the saver back to the caller, the context would never exit and the
    underlying connection would leak. We therefore call ``__exit__`` on any
    failure during setup, and defer it to the lifespan ``close`` callback only
    on the happy path.
    """

    if database_url.startswith(("postgres://", "postgresql://")):
        context = PostgresSaver.from_conn_string(database_url)
        saver = context.__enter__()
        try:
            saver.setup()
        except BaseException:
            context.__exit__(None, None, None)
            raise

        def close_postgres() -> None:
            context.__exit__(None, None, None)

        return CheckpointResource(
            saver=saver,
            close=close_postgres,
        )

    sqlite_saver = create_sqlite_checkpointer(database_url)
    connection = sqlite_saver.conn

    def close_sqlite() -> None:
        connection.close()

    return CheckpointResource(saver=sqlite_saver, close=close_sqlite)
