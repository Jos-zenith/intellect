import json
from datetime import datetime, timezone
from typing import Any

from app.db import fetch_all, json_value, normalize_iso8601, execute


def _extract_optional(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def log_event(event_type: str, payload: dict) -> None:
    created_at = datetime.now(timezone.utc).isoformat()
    week_tag = _extract_optional(payload, "week_tag")
    student_id = _extract_optional(payload, "student_id")
    source_service = _extract_optional(payload, "source_service")

    execute(
        """
        INSERT INTO audit_logs(created_at, event_type, payload_json, week_tag, student_id, source_service)
        VALUES (%s, %s, %s::jsonb, %s, %s, %s)
        """,
        (created_at, event_type, json_value(payload), week_tag, student_id, source_service),
    )


def recent_events(limit: int = 50) -> list[dict]:
    rows = fetch_all(
        """
        SELECT id, created_at, event_type, payload_json
        FROM audit_logs
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (max(1, limit),),
    )

    events = []
    for row in rows:
        raw_payload = row.get("payload_json")
        if isinstance(raw_payload, str):
            payload = json.loads(raw_payload)
        elif isinstance(raw_payload, dict):
            payload = raw_payload
        else:
            payload = {}

        created_at = normalize_iso8601(str(row.get("created_at", "")))
        events.append(
            {
                "id": int(row.get("id", 0)),
                "created_at": created_at,
                "event_type": str(row.get("event_type", "")),
                "payload": payload,
            }
        )
    return events
