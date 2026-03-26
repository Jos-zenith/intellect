from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

from app.config import settings


_pool: Any | None = None
_pool_lock = threading.Lock()


def _build_conninfo() -> str:
    if settings.supabase_database_url:
        return settings.supabase_database_url

    if settings.bolt_database_url:
        return settings.bolt_database_url

    supabase_required = [
        settings.supabase_db_host,
        settings.supabase_db_name,
        settings.supabase_db_user,
        settings.supabase_db_password,
    ]
    if all(supabase_required):
        return (
            f"host={settings.supabase_db_host} "
            f"port={settings.supabase_db_port} "
            f"dbname={settings.supabase_db_name} "
            f"user={settings.supabase_db_user} "
            f"password={settings.supabase_db_password} "
            f"sslmode={settings.supabase_db_sslmode} "
            f"connect_timeout={settings.supabase_connect_timeout_seconds}"
        )

    required = [
        settings.bolt_db_host,
        settings.bolt_db_name,
        settings.bolt_db_user,
        settings.bolt_db_password,
    ]
    if not all(required):
        raise RuntimeError(
            "Supabase database is not configured. Set SUPABASE_DATABASE_URL or SUPABASE_DB_HOST/SUPABASE_DB_NAME/SUPABASE_DB_USER/SUPABASE_DB_PASSWORD."
        )

    return (
        f"host={settings.bolt_db_host} "
        f"port={settings.bolt_db_port} "
        f"dbname={settings.bolt_db_name} "
        f"user={settings.bolt_db_user} "
        f"password={settings.bolt_db_password} "
        f"sslmode={settings.bolt_db_sslmode} "
        f"connect_timeout={settings.bolt_connect_timeout_seconds}"
    )


def get_pool() -> Any:
    global _pool
    if _pool is not None:
        return _pool

    with _pool_lock:
        if _pool is None:
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool

            conninfo = _build_conninfo()
            _pool = ConnectionPool(
                conninfo=conninfo,
                min_size=max(1, settings.supabase_pool_min_size or settings.bolt_pool_min_size),
                max_size=max(1, settings.supabase_pool_max_size or settings.bolt_pool_max_size),
                timeout=max(5, settings.supabase_connect_timeout_seconds or settings.bolt_connect_timeout_seconds),
                kwargs={"row_factory": dict_row},
                open=True,
            )
    return _pool


def _run_with_retry(fn: Callable[[], Any]) -> Any:
    attempts = max(1, settings.supabase_retry_attempts or settings.bolt_retry_attempts)
    backoff = 0.25
    last_error: Exception | None = None
    retriable_errors: tuple[type[Exception], ...] = (Exception,)

    try:
        from psycopg import DatabaseError, OperationalError

        retriable_errors = (OperationalError, DatabaseError)
    except Exception:
        # Keep default in environments that cannot import psycopg during analysis.
        retriable_errors = (Exception,)

    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except retriable_errors as exc:
            last_error = exc
            if attempt >= attempts:
                break
            time.sleep(backoff)
            backoff *= 2

    raise RuntimeError(f"Supabase database operation failed after {attempts} attempts: {last_error}")


def execute(statement: str, params: tuple[Any, ...] = ()) -> None:
    def _inner() -> None:
        with get_pool().connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(statement, params)
            conn.commit()

    _run_with_retry(_inner)


def fetch_all(statement: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    def _inner() -> list[dict[str, Any]]:
        with get_pool().connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(statement, params)
                rows = cursor.fetchall()
        return [dict(row) for row in rows]

    result = _run_with_retry(_inner)
    return result if isinstance(result, list) else []


def fetch_one(statement: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    rows = fetch_all(statement, params)
    if not rows:
        return None
    return rows[0]


def json_value(payload: dict[str, Any]) -> str:
    import json

    return json.dumps(payload, ensure_ascii=True)


def normalize_iso8601(value: str) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()

    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.isoformat()
    except ValueError:
        return datetime.now(timezone.utc).isoformat()


def init_supabase_schema() -> None:
    ddl_statements = [
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL,
            event_type TEXT NOT NULL,
            payload_json JSONB NOT NULL,
            week_tag TEXT,
            student_id TEXT,
            source_service TEXT,
            old_audit_id BIGINT UNIQUE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS knowledge_versions (
            revision_id BIGSERIAL PRIMARY KEY,
            week_tag TEXT NOT NULL,
            stage TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            summary_json JSONB NOT NULL,
            source_type TEXT,
            old_revision_id BIGINT UNIQUE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS student_profiles (
            id BIGSERIAL PRIMARY KEY,
            student_id TEXT NOT NULL UNIQUE,
            full_name TEXT,
            program TEXT,
            semester TEXT,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS rubric_criteria (
            id BIGSERIAL PRIMARY KEY,
            rubric_key TEXT NOT NULL,
            criterion_code TEXT NOT NULL,
            description TEXT NOT NULL,
            max_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
            required_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
            institution_code TEXT,
            institution_rule_id TEXT,
            rule_category TEXT,
            lineage_ref TEXT,
            week_tag TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (rubric_key, criterion_code)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS rubric_lineage_events (
            event_id BIGSERIAL PRIMARY KEY,
            student_id TEXT NOT NULL,
            week_tag TEXT NOT NULL,
            rubric_key TEXT NOT NULL,
            question TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            lineage_json JSONB NOT NULL,
            loss_run_json JSONB NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS co_po_mappings (
            id BIGSERIAL PRIMARY KEY,
            course_code TEXT NOT NULL,
            co_tag TEXT NOT NULL,
            po_tag TEXT NOT NULL,
            weight NUMERIC(6, 3) NOT NULL DEFAULT 1,
            week_tag TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS knowledge_snapshots (
            snapshot_id BIGSERIAL PRIMARY KEY,
            week_tag TEXT NOT NULL,
            revision_id BIGINT,
            stage TEXT NOT NULL,
            source_label TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            snapshot_json JSONB NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS monday_stream_sessions (
            session_id TEXT PRIMARY KEY,
            week_tag TEXT NOT NULL,
            source_label TEXT NOT NULL,
            date_stamp TEXT NOT NULL,
            transcript_buffer TEXT NOT NULL DEFAULT '',
            audio_buffer BYTEA NOT NULL DEFAULT ''::bytea,
            transcript_chunk_count INTEGER NOT NULL DEFAULT 0,
            audio_chunk_count INTEGER NOT NULL DEFAULT 0,
            finalized BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS tutoring_sessions (
            session_id TEXT PRIMARY KEY,
            student_id TEXT,
            week_tag TEXT,
            difficulty_level TEXT NOT NULL DEFAULT 'foundation',
            confusion_streak INTEGER NOT NULL DEFAULT 0,
            turn_count INTEGER NOT NULL DEFAULT 0,
            last_socratic_mode TEXT NOT NULL DEFAULT 'why',
            session_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS tutoring_session_turns (
            id BIGSERIAL PRIMARY KEY,
            session_id TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            confusion_detected BOOLEAN NOT NULL DEFAULT FALSE,
            socratic_mode TEXT NOT NULL,
            difficulty_level TEXT NOT NULL,
            citations_json JSONB NOT NULL,
            metadata_json JSONB NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS internal_assessment_results (
            id BIGSERIAL PRIMARY KEY,
            week_tag TEXT NOT NULL,
            course_code TEXT NOT NULL,
            student_id TEXT NOT NULL,
            marks_obtained NUMERIC(8, 2) NOT NULL,
            max_marks NUMERIC(8, 2) NOT NULL,
            co_scores_json JSONB NOT NULL,
            po_scores_json JSONB NOT NULL,
            attendance_ratio NUMERIC(5, 4),
            feedback TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS attainment_records (
            id BIGSERIAL PRIMARY KEY,
            week_tag TEXT NOT NULL,
            course_code TEXT NOT NULL,
            attainment_percentage NUMERIC(8, 2) NOT NULL,
            co_attainment_json JSONB NOT NULL,
            po_attainment_json JSONB NOT NULL,
            target_percentage NUMERIC(8, 2) NOT NULL,
            compliant BOOLEAN NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS accreditation_evidence (
            id BIGSERIAL PRIMARY KEY,
            week_tag TEXT NOT NULL,
            course_code TEXT NOT NULL,
            evidence_type TEXT NOT NULL,
            lineage_json JSONB NOT NULL,
            payload_json JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS faculty_overrides (
            id BIGSERIAL PRIMARY KEY,
            week_tag TEXT NOT NULL,
            course_code TEXT NOT NULL,
            scope TEXT NOT NULL,
            reference_id TEXT NOT NULL,
            override_payload JSONB NOT NULL,
            reviewer TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'applied',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS lms_webhooks (
            id BIGSERIAL PRIMARY KEY,
            event_type TEXT NOT NULL,
            target_url TEXT NOT NULL,
            secret_token TEXT,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS api_usage_metrics (
            id BIGSERIAL PRIMARY KEY,
            path TEXT NOT NULL,
            method TEXT NOT NULL,
            status_code INTEGER NOT NULL,
            latency_ms NUMERIC(10, 3) NOT NULL,
            client_ip TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_audit_logs_week_tag ON audit_logs (week_tag)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_audit_logs_student_id ON audit_logs (student_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_knowledge_versions_week_tag ON knowledge_versions (week_tag)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_knowledge_versions_created_at ON knowledge_versions (created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_student_profiles_student_id ON student_profiles (student_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_student_profiles_updated_at ON student_profiles (updated_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rubric_criteria_week_tag ON rubric_criteria (week_tag)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rubric_criteria_rubric_key ON rubric_criteria (rubric_key)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rubric_criteria_rule_category ON rubric_criteria (rule_category)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rubric_criteria_created_at ON rubric_criteria (created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rubric_lineage_events_student_id ON rubric_lineage_events (student_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rubric_lineage_events_week_tag ON rubric_lineage_events (week_tag)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rubric_lineage_events_created_at ON rubric_lineage_events (created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_co_po_mappings_week_tag ON co_po_mappings (week_tag)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_co_po_mappings_created_at ON co_po_mappings (created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_knowledge_snapshots_week_tag ON knowledge_snapshots (week_tag)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_knowledge_snapshots_revision_id ON knowledge_snapshots (revision_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_knowledge_snapshots_created_at ON knowledge_snapshots (created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_monday_stream_sessions_week_tag ON monday_stream_sessions (week_tag)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_monday_stream_sessions_updated_at ON monday_stream_sessions (updated_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_tutoring_sessions_student_id ON tutoring_sessions (student_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_tutoring_sessions_week_tag ON tutoring_sessions (week_tag)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_tutoring_sessions_updated_at ON tutoring_sessions (updated_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_tutoring_session_turns_session_id ON tutoring_session_turns (session_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_tutoring_session_turns_created_at ON tutoring_session_turns (created_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_internal_assessment_results_week_course ON internal_assessment_results (week_tag, course_code)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_internal_assessment_results_student_id ON internal_assessment_results (student_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_attainment_records_week_course ON attainment_records (week_tag, course_code)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_accreditation_evidence_week_course ON accreditation_evidence (week_tag, course_code)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_faculty_overrides_week_course ON faculty_overrides (week_tag, course_code)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_faculty_overrides_scope_ref ON faculty_overrides (scope, reference_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_lms_webhooks_event_type ON lms_webhooks (event_type)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_api_usage_metrics_path_method ON api_usage_metrics (path, method)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_api_usage_metrics_created_at ON api_usage_metrics (created_at DESC)
        """,
    ]

    for ddl in ddl_statements:
        execute(ddl)

    alter_statements = [
        "ALTER TABLE rubric_criteria ADD COLUMN IF NOT EXISTS institution_code TEXT",
        "ALTER TABLE rubric_criteria ADD COLUMN IF NOT EXISTS institution_rule_id TEXT",
        "ALTER TABLE rubric_criteria ADD COLUMN IF NOT EXISTS rule_category TEXT",
        "ALTER TABLE rubric_criteria ADD COLUMN IF NOT EXISTS lineage_ref TEXT",
    ]

    for ddl in alter_statements:
        execute(ddl)


def init_bolt_schema() -> None:
    # Backward-compatible alias for existing call sites.
    init_supabase_schema()
