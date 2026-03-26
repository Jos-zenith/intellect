from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.db import get_pool, init_bolt_schema


def _normalize_iso(value: str) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()

    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return datetime.now(timezone.utc).isoformat()

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _safe_json(payload: str | None) -> dict:
    if not payload:
        return {}
    try:
        loaded = json.loads(payload)
        return loaded if isinstance(loaded, dict) else {"value": loaded}
    except json.JSONDecodeError:
        return {}


def migrate_audit_events(sqlite_conn: sqlite3.Connection) -> int:
    rows = sqlite_conn.execute(
        "SELECT id, created_at, event_type, payload_json FROM audit_events ORDER BY id ASC"
    ).fetchall()
    if not rows:
        return 0

    inserted = 0
    with get_pool().connection() as bolt_conn:
        with bolt_conn.cursor() as cursor:
            for row in rows:
                old_id = int(row[0])
                created_at = _normalize_iso(str(row[1]))
                event_type = str(row[2])
                payload = _safe_json(str(row[3]))
                week_tag = str(payload.get("week_tag", "")).strip() or None
                student_id = str(payload.get("student_id", "")).strip() or None
                source_service = str(payload.get("source_service", "")).strip() or None

                cursor.execute(
                    """
                    INSERT INTO audit_logs(
                        created_at, event_type, payload_json, week_tag, student_id, source_service, old_audit_id
                    )
                    VALUES (%s, %s, %s::jsonb, %s, %s, %s, %s)
                    ON CONFLICT (old_audit_id) DO NOTHING
                    """,
                    (created_at, event_type, json.dumps(payload, ensure_ascii=True), week_tag, student_id, source_service, old_id),
                )
                inserted += cursor.rowcount

        bolt_conn.commit()

    return inserted


def migrate_knowledge_versions(sqlite_conn: sqlite3.Connection) -> int:
    rows = sqlite_conn.execute(
        "SELECT revision_id, week_tag, stage, created_at, summary_json FROM knowledge_versions ORDER BY revision_id ASC"
    ).fetchall()
    if not rows:
        return 0

    inserted = 0
    with get_pool().connection() as bolt_conn:
        with bolt_conn.cursor() as cursor:
            for row in rows:
                old_revision_id = int(row[0])
                week_tag = str(row[1])
                stage = str(row[2])
                created_at = _normalize_iso(str(row[3]))
                summary = _safe_json(str(row[4]))

                cursor.execute(
                    """
                    INSERT INTO knowledge_versions(week_tag, stage, created_at, summary_json, old_revision_id)
                    VALUES (%s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (old_revision_id) DO NOTHING
                    """,
                    (week_tag, stage, created_at, json.dumps(summary, ensure_ascii=True), old_revision_id),
                )
                inserted += cursor.rowcount

        bolt_conn.commit()

    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate SQLite audit trail and knowledge versions to Bolt DB")
    parser.add_argument(
        "--sqlite-path",
        default=settings.audit_db_path,
        help="Path to legacy SQLite database file (default: AUDIT_DB_PATH)",
    )
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite_path)
    if not sqlite_path.exists():
        raise FileNotFoundError(f"SQLite source database not found: {sqlite_path}")

    init_bolt_schema()

    sqlite_conn = sqlite3.connect(str(sqlite_path))
    try:
        audit_inserted = migrate_audit_events(sqlite_conn)
        versions_inserted = migrate_knowledge_versions(sqlite_conn)
    finally:
        sqlite_conn.close()

    print(
        json.dumps(
            {
                "status": "ok",
                "sqlite_source": str(sqlite_path),
                "audit_logs_inserted": audit_inserted,
                "knowledge_versions_inserted": versions_inserted,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
