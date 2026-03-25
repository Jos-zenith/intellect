import json
import sqlite3
from datetime import datetime
from pathlib import Path

from app.config import settings


def _get_conn() -> sqlite3.Connection:
    Path(settings.audit_db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.audit_db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS knowledge_versions (
            revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
            week_tag TEXT NOT NULL,
            stage TEXT NOT NULL,
            created_at TEXT NOT NULL,
            summary_json TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def create_knowledge_revision(week_tag: str, stage: str, summary: dict) -> int:
    conn = _get_conn()
    try:
        cursor = conn.execute(
            "INSERT INTO knowledge_versions(week_tag, stage, created_at, summary_json) VALUES (?, ?, ?, ?)",
            (week_tag, stage, datetime.utcnow().isoformat(), json.dumps(summary, ensure_ascii=True)),
        )
        conn.commit()
        if cursor.lastrowid is None:
            raise RuntimeError("Failed to create knowledge revision")
        return int(cursor.lastrowid)
    finally:
        conn.close()


def list_knowledge_revisions(week_tag: str | None = None, limit: int = 50) -> list[dict]:
    conn = _get_conn()
    try:
        if week_tag:
            rows = conn.execute(
                """
                SELECT revision_id, week_tag, stage, created_at, summary_json
                FROM knowledge_versions
                WHERE week_tag = ?
                ORDER BY revision_id DESC
                LIMIT ?
                """,
                (week_tag, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT revision_id, week_tag, stage, created_at, summary_json
                FROM knowledge_versions
                ORDER BY revision_id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    finally:
        conn.close()

    revisions: list[dict] = []
    for row in rows:
        revisions.append(
            {
                "revision_id": row[0],
                "week_tag": row[1],
                "stage": row[2],
                "created_at": row[3],
                "summary": json.loads(row[4]),
            }
        )
    return revisions
