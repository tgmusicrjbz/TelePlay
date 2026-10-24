"""Export or restore all Komod database metadata.

Media bytes remain in Telegram; this archive contains the relational metadata
needed to move a deployment between Railway projects or database providers.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import gzip
import json
import os
from datetime import date, datetime
from pathlib import Path
import sys

from sqlalchemy import delete, insert, select, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import Base, engine  # noqa: E402
from app import models as _models  # noqa: F401,E402  (register every table)


def encode_value(value):
    if isinstance(value, datetime):
        return {"$type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"$type": "date", "value": value.isoformat()}
    if isinstance(value, bytes):
        return {"$type": "bytes", "value": base64.b64encode(value).decode("ascii")}
    return value


def decode_value(value):
    if not isinstance(value, dict) or "$type" not in value:
        return value
    if value["$type"] == "datetime":
        return datetime.fromisoformat(value["value"])
    if value["$type"] == "date":
        return date.fromisoformat(value["value"])
    if value["$type"] == "bytes":
        return base64.b64decode(value["value"])
    return value


def open_text(path: Path, mode: str):
    return gzip.open(path, mode + "t", encoding="utf-8") if path.suffix == ".gz" else path.open(mode, encoding="utf-8")


def validate_payload(payload: object):
    """Validate a backup completely before any destructive restore starts."""
    if not isinstance(payload, dict) or payload.get("format") != "komod-db-backup" or payload.get("version") != 1:
        raise ValueError("Unsupported backup format")
    raw_tables = payload.get("tables")
    if not isinstance(raw_tables, dict):
        raise ValueError("Backup tables must be an object")
    tables = {table.name: table for table in Base.metadata.sorted_tables}
    unknown = set(raw_tables) - set(tables)
    if unknown:
        raise ValueError(f"Backup contains unknown tables: {', '.join(sorted(unknown))}")
    count = 0
    for table_name, rows in raw_tables.items():
        if not isinstance(rows, list):
            raise ValueError(f"Rows for table {table_name} must be a list")
        allowed_columns = set(tables[table_name].c.keys())
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError(f"Invalid row {index} in table {table_name}")
            unknown_columns = set(row) - allowed_columns
            if unknown_columns:
                raise ValueError(
                    f"Unknown columns in {table_name}: {', '.join(sorted(unknown_columns))}"
                )
            for value in row.values():
                decode_value(value)
        count += len(rows)
    return tables, count


def read_backup(source: Path):
    with open_text(source, "r") as handle:
        payload = json.load(handle)
    tables, count = validate_payload(payload)
    return payload, tables, count


async def export_database(output: Path):
    payload = {"format": "komod-db-backup", "version": 1, "created_at": datetime.utcnow().isoformat(), "tables": {}}
    async with engine.connect() as connection:
        for table in Base.metadata.sorted_tables:
            rows = (await connection.execute(select(table))).mappings().all()
            payload["tables"][table.name] = [
                {key: encode_value(value) for key, value in row.items()} for row in rows
            ]
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.stem}.tmp{output.suffix}")
    try:
        with open_text(temporary, "w") as target:
            json.dump(payload, target, ensure_ascii=False, separators=(",", ":"))
        temporary.replace(output)
        if os.name != "nt":
            output.chmod(0o600)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Backup written: {output} ({sum(map(len, payload['tables'].values()))} rows)")


async def import_database(source: Path, clear: bool, dry_run: bool):
    try:
        payload, tables, count = read_backup(source)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise SystemExit(f"Backup validation failed: {error}") from error
    print(f"Validated {count} rows from {source}")
    if dry_run:
        return
    async with engine.begin() as connection:
        if clear:
            for table in reversed(Base.metadata.sorted_tables):
                await connection.execute(delete(table))
        for table in Base.metadata.sorted_tables:
            rows = payload["tables"].get(table.name, [])
            if not rows:
                continue
            decoded = [{key: decode_value(value) for key, value in row.items()} for row in rows]
            await connection.execute(insert(table), decoded)
        if engine.dialect.name == "postgresql":
            for table in Base.metadata.sorted_tables:
                if "id" in table.c and table.c.id.autoincrement:
                    quoted = table.name.replace('"', '""')
                    await connection.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('\"{quoted}\"','id'), "
                        f"COALESCE((SELECT MAX(id) FROM \"{quoted}\"), 1), "
                        f"EXISTS(SELECT 1 FROM \"{quoted}\"))"
                    ))
    print(f"Restore completed: {count} rows")


async def main():
    parser = argparse.ArgumentParser(description="Komod metadata backup and restore")
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--output", required=True, type=Path)
    restore = commands.add_parser("import")
    restore.add_argument("--input", required=True, type=Path)
    restore.add_argument("--clear", action="store_true", help="Delete current data before importing")
    restore.add_argument("--dry-run", action="store_true")
    validate = commands.add_parser("validate")
    validate.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "export":
        await export_database(args.output)
    elif args.command == "validate":
        try:
            _, _, count = read_backup(args.input)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise SystemExit(f"Backup validation failed: {error}") from error
        print(f"Backup is valid: {args.input} ({count} rows)")
    else:
        await import_database(args.input, args.clear, args.dry_run)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
