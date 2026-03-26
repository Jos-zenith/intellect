import json
from datetime import datetime

from app.db import fetch_all, json_value, normalize_iso8601


def create_knowledge_revision(week_tag: str, stage: str, summary: dict) -> int:
    created_at = datetime.utcnow().isoformat()
    rows = fetch_all(
        """
        INSERT INTO knowledge_versions(week_tag, stage, created_at, summary_json)
        VALUES (%s, %s, %s, %s::jsonb)
        RETURNING revision_id
        """,
        (week_tag, stage, created_at, json_value(summary)),
    )
    if not rows:
        raise RuntimeError("Failed to create knowledge revision")
    return int(rows[0]["revision_id"])


def list_knowledge_revisions(week_tag: str | None = None, limit: int = 50) -> list[dict]:
    if week_tag:
        rows = fetch_all(
            """
            SELECT revision_id, week_tag, stage, created_at, summary_json
            FROM knowledge_versions
            WHERE week_tag = %s
            ORDER BY revision_id DESC
            LIMIT %s
            """,
            (week_tag, max(1, limit)),
        )
    else:
        rows = fetch_all(
            """
            SELECT revision_id, week_tag, stage, created_at, summary_json
            FROM knowledge_versions
            ORDER BY revision_id DESC
            LIMIT %s
            """,
            (max(1, limit),),
        )

    revisions: list[dict] = []
    for row in rows:
        raw_summary = row.get("summary_json")
        if isinstance(raw_summary, str):
            summary = json.loads(raw_summary)
        elif isinstance(raw_summary, dict):
            summary = raw_summary
        else:
            summary = {}

        revisions.append(
            {
                "revision_id": int(row.get("revision_id", 0)),
                "week_tag": str(row.get("week_tag", "")),
                "stage": str(row.get("stage", "")),
                "created_at": normalize_iso8601(str(row.get("created_at", ""))),
                "summary": summary,
            }
        )
    return revisions
