"""Regression tests for the versioned database schema."""
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
HEAD_REVISION = "20261026_0005"


def migration_env(database_path: Path) -> dict[str, str]:
    env = os.environ.copy()
    env.update({
        "DATABASE_URL": f"sqlite:///{database_path.as_posix()}",
        "TELEGRAM_API_ID": "12345",
        "TELEGRAM_API_HASH": "test-hash",
        "TELEGRAM_BOT_TOKEN": "000000:test-token",
        "TELEGRAM_STORAGE_CHANNEL_ID": "-1001234567890",
        "JWT_SECRET": "migration-test-secret",
    })
    return env


def run_alembic(database_path: Path, *arguments: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=BACKEND_ROOT,
        env=migration_env(database_path),
        check=True,
        capture_output=True,
        text=True,
    )


class MigrationTests(unittest.TestCase):
    def test_fresh_database_reaches_current_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "fresh.sqlite"
            run_alembic(database, "upgrade", "head")
            connection = sqlite3.connect(database)
            try:
                revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
                tables = {row[0] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )}
            finally:
                connection.close()
            self.assertEqual(revision, HEAD_REVISION)
            self.assertIn("users", tables)
            self.assertIn("files", tables)
            self.assertIn("processing_jobs", tables)

    def test_existing_current_schema_is_adopted_without_data_loss(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "existing.sqlite"
            create_schema = (
                "from sqlalchemy import create_engine; "
                "from app.database import Base; "
                "from app import models; "
                f"engine=create_engine('sqlite:///{database.as_posix()}'); "
                "Base.metadata.create_all(engine); "
                "connection=engine.connect(); "
                "connection.exec_driver_sql('CREATE TABLE legacy_marker (value INTEGER NOT NULL)'); "
                "connection.exec_driver_sql('INSERT INTO legacy_marker VALUES (42)'); "
                "connection.commit(); connection.close()"
            )
            subprocess.run(
                [sys.executable, "-c", create_schema],
                cwd=BACKEND_ROOT,
                env=migration_env(database),
                check=True,
                capture_output=True,
                text=True,
            )
            run_alembic(database, "upgrade", "head")
            connection = sqlite3.connect(database)
            try:
                revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
                marker = connection.execute("SELECT value FROM legacy_marker").fetchone()[0]
            finally:
                connection.close()
            self.assertEqual(revision, HEAD_REVISION)
            self.assertEqual(marker, 42)


if __name__ == "__main__":
    unittest.main()
