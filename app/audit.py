import sqlite3
from datetime import datetime
from pathlib import Path
import json

from app.config import settings


def _get_conn() -> sqlite3.Connection:
    Path(settings.audit_db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.audit_db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def log_event(event_type: str, payload: dict) -> None:
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT INTO audit_events(created_at, event_type, payload_json) VALUES (?, ?, ?)",
            (datetime.utcnow().isoformat(), event_type, json.dumps(payload, ensure_ascii=True)),
        )
        conn.commit()
    finally:
        conn.close()


def recent_events(limit: int = 50) -> list[dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT id, created_at, event_type, payload_json FROM audit_events ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        conn.close()

    events = []
    for row in rows:
        events.append(
            {
                "id": row[0],
                "created_at": row[1],
                "event_type": row[2],
                "payload": json.loads(row[3]),
            }
        )
    return events
