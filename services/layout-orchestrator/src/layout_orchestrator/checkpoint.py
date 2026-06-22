"""Local durable checkpoint configuration for LangGraph sessions."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from langgraph.checkpoint.sqlite import SqliteSaver


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
