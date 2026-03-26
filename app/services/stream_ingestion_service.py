from __future__ import annotations

from datetime import datetime
from typing import Any

from app.audit import log_event
from app.db import execute, fetch_one
from app.knowledge_snapshot import store_knowledge_snapshot
from app.models import MondayIngestRequest, MondayStreamResponse, MondayTranscriptStreamRequest
from app.services.agile_rag_service import _derive_week_tag, monday_ingest_transcript
from app.llm import transcribe_audio


def _upsert_transcript_chunk(request: MondayTranscriptStreamRequest) -> dict[str, Any]:
    week_tag = _derive_week_tag(request.week_tag)
    date_stamp = request.date_stamp or datetime.utcnow().date().isoformat()

    row = fetch_one(
        """
        INSERT INTO monday_stream_sessions(
            session_id, week_tag, source_label, date_stamp, transcript_buffer, transcript_chunk_count, updated_at
        )
        VALUES (%s, %s, %s, %s, %s, 1, NOW())
        ON CONFLICT (session_id) DO UPDATE SET
            week_tag = EXCLUDED.week_tag,
            source_label = EXCLUDED.source_label,
            date_stamp = EXCLUDED.date_stamp,
            transcript_buffer = monday_stream_sessions.transcript_buffer || EXCLUDED.transcript_buffer,
            transcript_chunk_count = monday_stream_sessions.transcript_chunk_count + 1,
            updated_at = NOW()
        RETURNING
            session_id,
            week_tag,
            source_label,
            date_stamp,
            transcript_chunk_count,
            audio_chunk_count,
            LENGTH(transcript_buffer) AS transcript_chars,
            OCTET_LENGTH(audio_buffer) AS audio_bytes,
            transcript_buffer,
            finalized
        """,
        (
            request.session_id,
            week_tag,
            request.source_label,
            date_stamp,
            request.transcript_chunk,
        ),
    )
    if not row:
        raise RuntimeError("Unable to update transcript stream session")
    return row


def ingest_transcript_stream_chunk(request: MondayTranscriptStreamRequest) -> MondayStreamResponse:
    row = _upsert_transcript_chunk(request)

    if not request.is_final:
        return MondayStreamResponse(
            session_id=str(row["session_id"]),
            week_tag=str(row["week_tag"]),
            source_label=str(row["source_label"]),
            date_stamp=str(row["date_stamp"]),
            transcript_chunks=int(row["transcript_chunk_count"]),
            audio_chunks=int(row["audio_chunk_count"]),
            transcript_chars=int(row["transcript_chars"]),
            audio_bytes=int(row["audio_bytes"]),
            is_final=False,
        )

    transcript = str(row.get("transcript_buffer", "")).strip()
    if len(transcript) < 30:
        raise ValueError("Transcript stream buffer is too short to finalize")

    finalized = monday_ingest_transcript(
        MondayIngestRequest(
            transcript_text=transcript,
            week_tag=str(row["week_tag"]),
            source_label=str(row["source_label"]),
            date_stamp=str(row["date_stamp"]),
        )
    )

    execute(
        """
        UPDATE monday_stream_sessions
        SET finalized = TRUE, updated_at = NOW()
        WHERE session_id = %s
        """,
        (request.session_id,),
    )

    store_knowledge_snapshot(
        week_tag=finalized.week_tag,
        revision_id=finalized.knowledge_revision,
        stage="monday.stream.transcript.completed",
        source_label=finalized.source_label,
        extra={
            "session_id": request.session_id,
            "transcript_chunks": int(row["transcript_chunk_count"]),
            "transcript_chars": int(row["transcript_chars"]),
        },
    )

    log_event(
        "orchestrator.monday.stream.transcript.completed",
        {
            "session_id": request.session_id,
            "week_tag": finalized.week_tag,
            "source_label": finalized.source_label,
            "knowledge_revision": finalized.knowledge_revision,
            "paragraphs_indexed": finalized.paragraphs_indexed,
        },
    )

    return MondayStreamResponse(
        session_id=request.session_id,
        week_tag=finalized.week_tag,
        source_label=finalized.source_label,
        date_stamp=finalized.date_stamp,
        transcript_chunks=int(row["transcript_chunk_count"]),
        audio_chunks=int(row["audio_chunk_count"]),
        transcript_chars=int(row["transcript_chars"]),
        audio_bytes=int(row["audio_bytes"]),
        is_final=True,
        knowledge_revision=finalized.knowledge_revision,
        paragraphs_indexed=finalized.paragraphs_indexed,
    )


def _upsert_audio_chunk(
    session_id: str,
    audio_chunk: bytes,
    week_tag: str | None,
    source_label: str,
    date_stamp: str | None,
) -> dict[str, Any]:
    effective_week_tag = _derive_week_tag(week_tag)
    effective_date_stamp = date_stamp or datetime.utcnow().date().isoformat()

    row = fetch_one(
        """
        INSERT INTO monday_stream_sessions(
            session_id, week_tag, source_label, date_stamp, audio_buffer, audio_chunk_count, updated_at
        )
        VALUES (%s, %s, %s, %s, %s::bytea, 1, NOW())
        ON CONFLICT (session_id) DO UPDATE SET
            week_tag = EXCLUDED.week_tag,
            source_label = EXCLUDED.source_label,
            date_stamp = EXCLUDED.date_stamp,
            audio_buffer = monday_stream_sessions.audio_buffer || EXCLUDED.audio_buffer,
            audio_chunk_count = monday_stream_sessions.audio_chunk_count + 1,
            updated_at = NOW()
        RETURNING
            session_id,
            week_tag,
            source_label,
            date_stamp,
            transcript_chunk_count,
            audio_chunk_count,
            LENGTH(transcript_buffer) AS transcript_chars,
            OCTET_LENGTH(audio_buffer) AS audio_bytes,
            audio_buffer,
            finalized
        """,
        (
            session_id,
            effective_week_tag,
            source_label,
            effective_date_stamp,
            audio_chunk,
        ),
    )
    if not row:
        raise RuntimeError("Unable to update audio stream session")
    return row


def ingest_audio_stream_chunk(
    session_id: str,
    file_name: str,
    audio_chunk: bytes,
    week_tag: str | None = None,
    source_label: str | None = None,
    date_stamp: str | None = None,
    is_final: bool = False,
) -> MondayStreamResponse:
    effective_source = source_label or file_name.rsplit(".", 1)[0]
    row = _upsert_audio_chunk(
        session_id=session_id,
        audio_chunk=audio_chunk,
        week_tag=week_tag,
        source_label=effective_source,
        date_stamp=date_stamp,
    )

    if not is_final:
        return MondayStreamResponse(
            session_id=str(row["session_id"]),
            week_tag=str(row["week_tag"]),
            source_label=str(row["source_label"]),
            date_stamp=str(row["date_stamp"]),
            transcript_chunks=int(row["transcript_chunk_count"]),
            audio_chunks=int(row["audio_chunk_count"]),
            transcript_chars=int(row["transcript_chars"]),
            audio_bytes=int(row["audio_bytes"]),
            is_final=False,
        )

    full_audio = bytes(row.get("audio_buffer") or b"")
    if not full_audio:
        raise ValueError("Audio stream buffer is empty")

    transcript = transcribe_audio(file_name=file_name, audio_bytes=full_audio)
    finalized = monday_ingest_transcript(
        MondayIngestRequest(
            transcript_text=transcript,
            week_tag=str(row["week_tag"]),
            source_label=str(row["source_label"]),
            date_stamp=str(row["date_stamp"]),
        )
    )

    execute(
        """
        UPDATE monday_stream_sessions
        SET finalized = TRUE, updated_at = NOW()
        WHERE session_id = %s
        """,
        (session_id,),
    )

    store_knowledge_snapshot(
        week_tag=finalized.week_tag,
        revision_id=finalized.knowledge_revision,
        stage="monday.stream.audio.completed",
        source_label=finalized.source_label,
        extra={
            "session_id": session_id,
            "audio_chunks": int(row["audio_chunk_count"]),
            "audio_bytes": int(row["audio_bytes"]),
        },
    )

    log_event(
        "orchestrator.monday.stream.audio.completed",
        {
            "session_id": session_id,
            "week_tag": finalized.week_tag,
            "source_label": finalized.source_label,
            "knowledge_revision": finalized.knowledge_revision,
            "paragraphs_indexed": finalized.paragraphs_indexed,
            "audio_bytes": int(row["audio_bytes"]),
        },
    )

    return MondayStreamResponse(
        session_id=session_id,
        week_tag=finalized.week_tag,
        source_label=finalized.source_label,
        date_stamp=finalized.date_stamp,
        transcript_chunks=int(row["transcript_chunk_count"]),
        audio_chunks=int(row["audio_chunk_count"]),
        transcript_chars=int(row["transcript_chars"]),
        audio_bytes=int(row["audio_bytes"]),
        is_final=True,
        knowledge_revision=finalized.knowledge_revision,
        paragraphs_indexed=finalized.paragraphs_indexed,
    )
