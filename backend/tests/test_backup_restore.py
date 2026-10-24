"""Regression tests for the deployment backup format."""
import os
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./backup-test.sqlite")
os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.backup_restore import decode_value, encode_value, read_backup, validate_payload


class BackupRestoreTests(unittest.TestCase):
    def test_special_values_round_trip(self):
        values = [datetime(2026, 10, 24, 12, 30), date(2026, 10, 24), b"komod"]
        self.assertEqual(values, [decode_value(encode_value(value)) for value in values])

    def test_validation_rejects_unknown_columns_before_restore(self):
        with self.assertRaisesRegex(ValueError, "Unknown columns"):
            validate_payload({
                "format": "komod-db-backup",
                "version": 1,
                "tables": {"users": [{"definitely_not_a_column": "unsafe"}]},
            })

    def test_gzip_backup_can_be_validated_without_restoring(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "komod.json.gz"
            import gzip, json
            with gzip.open(path, "wt", encoding="utf-8") as target:
                json.dump({"format": "komod-db-backup", "version": 1, "tables": {}}, target)
            _, _, count = read_backup(path)
            self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
