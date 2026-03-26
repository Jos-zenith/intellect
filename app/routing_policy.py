from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class RouteDecision:
    agent_id: str
    routed_by: str
    urgency_override: bool
    scorecard: dict[str, float]
    decision_trace: list[str]


def _contains_any(text: str, keywords: set[str]) -> bool:
    lowered = text.lower()
    return any(token in lowered for token in keywords)


def _effective_exam_days(profile: dict[str, Any]) -> int | None:
    days_until_exam = profile.get("days_until_exam")
    prep_window = profile.get("preparation_window_days")

    candidates: list[int] = []
    for candidate in (days_until_exam, prep_window):
        if candidate is None:
            continue
        try:
            candidates.append(int(candidate))
        except (TypeError, ValueError):
            continue

    if not candidates:
        return None
    return max(0, min(candidates))


def evaluate_routing_policy(profile: dict[str, Any]) -> RouteDecision:
    marks = [float(m) for m in (profile.get("marks") or []) if isinstance(m, (int, float))]
    avg_marks = sum(marks) / len(marks) if marks else 0.0

    feedback = str(profile.get("feedback") or "")
    habits = str(profile.get("study_habits") or "")
    attendance = profile.get("attendance_ratio")
    attendance_ratio = float(attendance) if isinstance(attendance, (int, float)) else None
    exam_days = _effective_exam_days(profile)

    scorecard: dict[str, float] = {
        "agent_a": 0.0,
        "agent_b": 0.0,
        "agent_c": 0.0,
        "agent_d": 0.0,
        "agent_e": 0.0,
        "agent_f": 0.0,
    }
    trace: list[str] = []

    if exam_days is not None and exam_days <= 2:
        scorecard["agent_f"] += 100.0
        trace.append(f"Urgency override triggered (exam_days={exam_days}) -> agent_f")
        return RouteDecision(
            agent_id="agent_f",
            routed_by="policy-override-urgency-exam-in-2-days",
            urgency_override=True,
            scorecard=scorecard,
            decision_trace=trace,
        )

    if avg_marks >= 85:
        scorecard["agent_a"] += 6.0
        trace.append("High marks signal -> boost agent_a")
    elif avg_marks < 45:
        scorecard["agent_d"] += 7.0
        trace.append("Low marks signal -> boost agent_d")
    elif avg_marks < 60:
        scorecard["agent_d"] += 4.5
        scorecard["agent_e"] += 1.5
        trace.append("Mid-low marks signal -> boost agent_d and agent_e")

    rubric_terms = {"rubric", "presentation", "steps missing", "marking scheme", "keywords missing"}
    if _contains_any(feedback, rubric_terms):
        scorecard["agent_b"] += 8.0
        trace.append("Rubric-gap language in feedback -> boost agent_b")

    rote_terms = {"memorise", "memorize", "rote", "formula", "byheart"}
    if _contains_any(habits, rote_terms):
        scorecard["agent_c"] += 7.5
        trace.append("Rote-learning habits detected -> boost agent_c")

    basic_terms = {"basic", "fundamental", "foundation", "concept unclear"}
    if _contains_any(feedback, basic_terms):
        scorecard["agent_d"] += 5.0
        trace.append("Weak-basics signal in feedback -> boost agent_d")

    inconsistency_terms = {"inconsistent", "irregular", "fluctuating", "on and off"}
    if _contains_any(feedback, inconsistency_terms) or _contains_any(habits, inconsistency_terms):
        scorecard["agent_e"] += 7.0
        trace.append("Inconsistency signal detected -> boost agent_e")

    if attendance_ratio is not None and attendance_ratio < 0.7:
        scorecard["agent_e"] += 3.0
        trace.append("Low attendance -> boost agent_e")

    if exam_days is not None and 3 <= exam_days <= 5:
        scorecard["agent_f"] += 3.5
        trace.append("Near-term exam (3-5 days) -> moderate boost agent_f")

    if all(v == 0.0 for v in scorecard.values()):
        scorecard["agent_e"] = 1.0
        trace.append("No strong signals -> default calibration agent_e")

    best_agent = max(scorecard.items(), key=lambda item: item[1])[0]
    return RouteDecision(
        agent_id=best_agent,
        routed_by="policy-scorecard",
        urgency_override=False,
        scorecard=scorecard,
        decision_trace=trace,
    )
