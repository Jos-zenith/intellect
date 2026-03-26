from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.db import fetch_one, json_value
from app.storage import get_week_chunks


def _compact_snapshot(week_tag: str, source_label: str | None = None) -> dict[str, Any]:
    records = get_week_chunks(week_tag)
    ids = [str(i) for i in records.get("ids", [])]
    docs = [str(d) for d in records.get("documents", [])]
    metadatas = records.get("metadatas", [])

    lineage_samples: list[str] = []
    source_files: set[str] = set()
    date_stamps: set[str] = set()
    source_types: set[str] = set()

    for meta in metadatas[:120]:
        source_file = str(meta.get("source_file", "unknown"))
        page = int(meta.get("page", 0))
        para = str(meta.get("paragraph_id", "unknown"))
        lineage_samples.append(f"{source_file}#p{page}:{para}")
        source_files.add(source_file)

        stamp = str(meta.get("date_stamp", "")).strip()
        if stamp:
            date_stamps.add(stamp)

        source_type = str(meta.get("source_type", "")).strip()
        if source_type:
            source_types.add(source_type)

    return {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "week_tag": week_tag,
        "source_label": source_label or "",
        "chunk_count": len(ids),
        "source_files": sorted(source_files),
        "source_types": sorted(source_types),
        "date_stamps": sorted(date_stamps),
        "lineage_samples": lineage_samples[:30],
        "sample_text": docs[:5],
    }


def store_knowledge_snapshot(
    week_tag: str,
    revision_id: int | None,
    stage: str,
    source_label: str | None = None,
    extra: dict[str, Any] | None = None,
) -> int:
    snapshot = _compact_snapshot(week_tag=week_tag, source_label=source_label)
    if extra:
        snapshot["extra"] = extra

    row = fetch_one(
        """
        INSERT INTO knowledge_snapshots(week_tag, revision_id, stage, source_label, snapshot_json)
        VALUES (%s, %s, %s, %s, %s::jsonb)
        RETURNING snapshot_id
        """,
        (week_tag, revision_id, stage, source_label, json_value(snapshot)),
    )
    if not row:
        raise RuntimeError("Failed to store knowledge snapshot")
    return int(row["snapshot_id"])
