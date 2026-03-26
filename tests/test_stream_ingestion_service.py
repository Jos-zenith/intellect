import pytest

import app.services.stream_ingestion_service as stream_service
from app.models import MondayIngestResponse, MondayTranscriptStreamRequest


def test_stream_ingestion_returns_non_final_state(monkeypatch) -> None:
    monkeypatch.setattr(
        stream_service,
        "_upsert_transcript_chunk",
        lambda _request: {
            "session_id": "S-1",
            "week_tag": "week-1",
            "source_label": "live",
            "date_stamp": "2025-08-01",
            "transcript_chunk_count": 2,
            "audio_chunk_count": 0,
            "transcript_chars": 120,
            "audio_bytes": 0,
            "transcript_buffer": "hello world",
        },
    )

    resp = stream_service.ingest_transcript_stream_chunk(
        MondayTranscriptStreamRequest(session_id="S-1", transcript_chunk="hello world", is_final=False)
    )

    assert resp.is_final is False
    assert resp.transcript_chunks == 2


def test_stream_ingestion_blocks_short_finalize(monkeypatch) -> None:
    monkeypatch.setattr(
        stream_service,
        "_upsert_transcript_chunk",
        lambda _request: {
            "session_id": "S-2",
            "week_tag": "week-1",
            "source_label": "live",
            "date_stamp": "2025-08-01",
            "transcript_chunk_count": 1,
            "audio_chunk_count": 0,
            "transcript_chars": 10,
            "audio_bytes": 0,
            "transcript_buffer": "too short",
        },
    )

    with pytest.raises(ValueError):
        stream_service.ingest_transcript_stream_chunk(
            MondayTranscriptStreamRequest(session_id="S-2", transcript_chunk="x", is_final=True)
        )


def test_stream_ingestion_finalize_success(monkeypatch) -> None:
    monkeypatch.setattr(
        stream_service,
        "_upsert_transcript_chunk",
        lambda _request: {
            "session_id": "S-3",
            "week_tag": "week-2",
            "source_label": "live",
            "date_stamp": "2025-08-02",
            "transcript_chunk_count": 3,
            "audio_chunk_count": 0,
            "transcript_chars": 90,
            "audio_bytes": 0,
            "transcript_buffer": "A" * 90,
        },
    )
    monkeypatch.setattr(stream_service, "execute", lambda *args, **kwargs: None)
    monkeypatch.setattr(stream_service, "store_knowledge_snapshot", lambda *args, **kwargs: None)
    monkeypatch.setattr(stream_service, "log_event", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        stream_service,
        "monday_ingest_transcript",
        lambda _request: MondayIngestResponse(
            week_tag="week-2",
            source_label="live",
            knowledge_revision=9,
            paragraphs_indexed=5,
            date_stamp="2025-08-02",
        ),
    )

    resp = stream_service.ingest_transcript_stream_chunk(
        MondayTranscriptStreamRequest(session_id="S-3", transcript_chunk="x", is_final=True)
    )

    assert resp.is_final is True
    assert resp.knowledge_revision == 9
