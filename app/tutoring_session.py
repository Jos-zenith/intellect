from __future__ import annotations

import uuid
from typing import Any

from app.db import execute, fetch_one, json_value


_DIFFICULTY_ORDER = ["foundation", "core", "advanced"]
_MODE_ORDER = ["why", "what_if", "how"]


def _next_mode(last_mode: str) -> str:
    if last_mode not in _MODE_ORDER:
        return "why"
    index = _MODE_ORDER.index(last_mode)
    return _MODE_ORDER[(index + 1) % len(_MODE_ORDER)]


def _step_difficulty(current: str, direction: int) -> str:
    if current not in _DIFFICULTY_ORDER:
        current = "foundation"
    idx = _DIFFICULTY_ORDER.index(current)
    next_idx = max(0, min(len(_DIFFICULTY_ORDER) - 1, idx + direction))
    return _DIFFICULTY_ORDER[next_idx]


def ensure_session(session_id: str | None, student_id: str | None, week_tag: str | None) -> dict[str, Any]:
    resolved_session_id = (session_id or "").strip() or f"session-{uuid.uuid4().hex[:12]}"

    row = fetch_one(
        """
        SELECT session_id, student_id, week_tag, difficulty_level, confusion_streak, turn_count, last_socratic_mode, session_state_json
        FROM tutoring_sessions
        WHERE session_id = %s
        """,
        (resolved_session_id,),
    )

    if row:
        return dict(row)

    execute(
        """
        INSERT INTO tutoring_sessions(session_id, student_id, week_tag)
        VALUES (%s, %s, %s)
        """,
        (resolved_session_id, (student_id or "").strip() or None, week_tag),
    )

    created = fetch_one(
        """
        SELECT session_id, student_id, week_tag, difficulty_level, confusion_streak, turn_count, last_socratic_mode, session_state_json
        FROM tutoring_sessions
        WHERE session_id = %s
        """,
        (resolved_session_id,),
    )
    if not created:
        raise RuntimeError("Failed to create tutoring session")
    return dict(created)


def choose_socratic_mode(question: str, session: dict[str, Any]) -> str:
    lowered = question.lower()
    if "why" in lowered:
        return "why"
    if "what if" in lowered or "what-if" in lowered:
        return "what_if"
    if "how" in lowered:
        return "how"

    last_mode = str(session.get("last_socratic_mode", "why"))
    return _next_mode(last_mode)


def detect_confusion(question: str) -> tuple[bool, list[str], float]:
    lowered = question.lower()
    signals: list[str] = []
    score = 0.0

    if any(token in lowered for token in {"confused", "dont understand", "don't understand", "stuck", "lost"}):
        signals.append("explicit_confusion_language")
        score += 0.6

    if lowered.count("?") >= 2:
        signals.append("multiple_question_marks")
        score += 0.15

    if any(token in lowered for token in {"again", "still", "repeat", "re-explain", "once more"}):
        signals.append("repeat_request_pattern")
        score += 0.25

    if len(lowered.split()) <= 5:
        signals.append("very_short_query")
        score += 0.1

    return score >= 0.5, signals, round(min(score, 1.0), 2)


def update_session_after_turn(
    *,
    session_id: str,
    question: str,
    answer: str,
    citations: list[dict[str, Any]],
    metadata: dict[str, Any],
    confusion_detected: bool,
    socratic_mode: str,
) -> dict[str, Any]:
    current = fetch_one(
        """
        SELECT session_id, difficulty_level, confusion_streak, turn_count, last_socratic_mode
        FROM tutoring_sessions
        WHERE session_id = %s
        """,
        (session_id,),
    )
    if not current:
        raise RuntimeError("Tutoring session not found for update")

    confusion_streak = int(current.get("confusion_streak", 0) or 0)
    turn_count = int(current.get("turn_count", 0) or 0)
    difficulty_level = str(current.get("difficulty_level", "foundation"))

    if confusion_detected:
        confusion_streak += 1
        difficulty_level = _step_difficulty(difficulty_level, -1)
    else:
        confusion_streak = max(0, confusion_streak - 1)
        if turn_count >= 1 and confusion_streak == 0:
            difficulty_level = _step_difficulty(difficulty_level, 1)

    next_turn_count = turn_count + 1
    next_state = {
        "latest_metadata": metadata,
        "latest_question": question,
        "latest_citation_count": len(citations),
    }

    execute(
        """
        UPDATE tutoring_sessions
        SET difficulty_level = %s,
            confusion_streak = %s,
            turn_count = %s,
            last_socratic_mode = %s,
            session_state_json = %s::jsonb,
            updated_at = NOW()
        WHERE session_id = %s
        """,
        (difficulty_level, confusion_streak, next_turn_count, socratic_mode, json_value(next_state), session_id),
    )

    execute(
        """
        INSERT INTO tutoring_session_turns(
            session_id,
            question,
            answer,
            confusion_detected,
            socratic_mode,
            difficulty_level,
            citations_json,
            metadata_json
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
        """,
        (
            session_id,
            question,
            answer,
            confusion_detected,
            socratic_mode,
            difficulty_level,
            json_value({"citations": citations}),
            json_value(metadata),
        ),
    )

    updated = fetch_one(
        """
        SELECT session_id, student_id, week_tag, difficulty_level, confusion_streak, turn_count, last_socratic_mode, session_state_json
        FROM tutoring_sessions
        WHERE session_id = %s
        """,
        (session_id,),
    )
    if not updated:
        raise RuntimeError("Failed to read updated tutoring session")
    return dict(updated)
