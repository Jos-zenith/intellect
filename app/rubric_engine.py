from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.db import execute, fetch_all, json_value


@dataclass
class RubricCriterion:
    criterion_code: str
    criterion: str
    max_score: float
    required_keywords: list[str]
    rule_category: str
    institution_rule_id: str
    lineage_ref: str


def _extract_keywords(text: str, limit: int = 6) -> list[str]:
    tokens = re.findall(r"[a-zA-Z][a-zA-Z\-]{2,}", text.lower())
    stop = {
        "the",
        "and",
        "for",
        "that",
        "with",
        "from",
        "into",
        "this",
        "your",
        "must",
        "show",
        "using",
        "answer",
        "should",
        "explain",
    }
    out: list[str] = []
    for token in tokens:
        if token in stop or token in out:
            continue
        out.append(token)
        if len(out) >= limit:
            break
    return out


def _classify_rule_category(text: str) -> str:
    lowered = text.lower()
    if any(token in lowered for token in {"diagram", "table", "presentation", "format", "structure"}):
        return "presentation"
    if any(token in lowered for token in {"data", "reference", "citation", "value", "evidence"}):
        return "data_gaps"
    return "logic"


def load_rubric_criteria(week_tag: str, rubric_key: str) -> list[RubricCriterion]:
    rows = fetch_all(
        """
        SELECT criterion_code, description, max_score, required_keywords, rule_category, institution_rule_id, lineage_ref
        FROM rubric_criteria
        WHERE rubric_key = %s
          AND (week_tag = %s OR week_tag IS NULL)
        ORDER BY max_score DESC, criterion_code ASC
        """,
        (rubric_key, week_tag),
    )

    criteria: list[RubricCriterion] = []
    for row in rows:
        required = row.get("required_keywords")
        if isinstance(required, list):
            keywords = [str(k).strip().lower() for k in required if str(k).strip()]
        else:
            keywords = []

        criterion_text = str(row.get("description", "")).strip()
        criteria.append(
            RubricCriterion(
                criterion_code=str(row.get("criterion_code", "CRIT")).strip() or "CRIT",
                criterion=criterion_text,
                max_score=float(row.get("max_score", 0.0) or 0.0),
                required_keywords=keywords or _extract_keywords(criterion_text),
                rule_category=str(row.get("rule_category", "")).strip() or _classify_rule_category(criterion_text),
                institution_rule_id=str(row.get("institution_rule_id", "")).strip(),
                lineage_ref=str(row.get("lineage_ref", "")).strip(),
            )
        )

    return criteria


def fallback_criteria_from_text(criteria_lines: list[str]) -> list[RubricCriterion]:
    fallback: list[RubricCriterion] = []
    for idx, line in enumerate(criteria_lines[:8], start=1):
        text = line.strip()
        if not text:
            continue
        fallback.append(
            RubricCriterion(
                criterion_code=f"CRIT-{idx}",
                criterion=text,
                max_score=2.0,
                required_keywords=_extract_keywords(text),
                rule_category=_classify_rule_category(text),
                institution_rule_id=f"fallback-rule-{idx}",
                lineage_ref="context-derived",
            )
        )
    return fallback


def _safe_div(num: float, den: float) -> float:
    if den <= 0:
        return 0.0
    return num / den


def evaluate_rubric(
    *,
    student_id: str,
    week_tag: str,
    rubric_key: str,
    question: str,
    draft_answer: str,
    criteria: list[RubricCriterion],
    rubric_source_lineage: list[str],
) -> dict[str, Any]:
    answer_lower = draft_answer.lower()

    met_criteria: list[dict[str, Any]] = []
    missed_criteria: list[dict[str, Any]] = []
    deductions: list[dict[str, Any]] = []
    rewrite_priority_ranked: list[dict[str, Any]] = []
    lineage_tracking: list[dict[str, Any]] = []

    awarded_total = 0.0
    max_total = 0.0

    for item in criteria:
        required = item.required_keywords
        matched = [kw for kw in required if kw in answer_lower]
        coverage = _safe_div(len(matched), max(len(required), 1))

        met = coverage >= 0.6 if required else item.criterion.lower() in answer_lower
        confidence = round(min(1.0, 0.3 + (0.7 * coverage)), 2)

        awarded = round(item.max_score * (coverage if required else (1.0 if met else 0.0)), 2)
        awarded = min(awarded, item.max_score)
        if met and awarded < (0.6 * item.max_score):
            awarded = round(0.6 * item.max_score, 2)

        mark_loss = round(max(item.max_score - awarded, 0.0), 2)

        explanation = (
            "Criterion satisfied with adequate rubric evidence."
            if met
            else f"Missing rubric evidence for {item.rule_category}. Add: {', '.join([kw for kw in required if kw not in matched]) or 'key expected details'}."
        )

        criterion_payload = {
            "criterion": item.criterion,
            "met": met,
            "confidence": confidence,
            "explanation": explanation,
            "required_keywords": required,
            "matched_keywords": matched,
        }

        if met:
            met_criteria.append(criterion_payload)
        else:
            missed_criteria.append(criterion_payload)

        if mark_loss > 0:
            deduction = {
                "criterion": item.criterion,
                "criterion_code": item.criterion_code,
                "gap_type": item.rule_category,
                "likely_mark_loss": mark_loss,
                "explanation": explanation,
            }
            deductions.append(deduction)

            recommendation = (
                f"Recover up to {mark_loss:.2f} marks by fixing {item.rule_category} gap in {item.criterion_code}. "
                f"Focus keywords: {', '.join([kw for kw in required if kw not in matched]) or 'add direct criterion evidence'}."
            )
            rewrite_priority_ranked.append(
                {
                    "criterion": item.criterion,
                    "criterion_code": item.criterion_code,
                    "gap_type": item.rule_category,
                    "mark_recovery_potential": mark_loss,
                    "confidence": confidence,
                    "recommendation": recommendation,
                }
            )

        lineage_tracking.append(
            {
                "criterion_code": item.criterion_code,
                "institution_rule_id": item.institution_rule_id or item.criterion_code,
                "rule_category": item.rule_category,
                "lineage_ref": item.lineage_ref or "rubric_criteria",
                "rubric_sources": rubric_source_lineage,
            }
        )

        awarded_total += awarded
        max_total += item.max_score

    rewrite_priority_ranked.sort(key=lambda row: (float(row["mark_recovery_potential"]), -float(row["confidence"])), reverse=True)

    explainable_feedback = [
        f"Predicted score {awarded_total:.2f}/{max_total:.2f} ({round(_safe_div(awarded_total, max_total) * 100, 2)}%).",
        f"Met {len(met_criteria)} criteria and missed {len(missed_criteria)} criteria.",
    ]
    for row in rewrite_priority_ranked[:3]:
        explainable_feedback.append(str(row["recommendation"]))

    structured_loss_run = {
        "rubric_key": rubric_key,
        "student_id": student_id,
        "week_tag": week_tag,
        "summary": {
            "met_count": len(met_criteria),
            "missed_count": len(missed_criteria),
            "predicted_score": round(awarded_total, 2),
            "max_score": round(max_total, 2),
            "forecast_percentage": round(_safe_div(awarded_total, max_total) * 100, 2),
        },
        "criteria": {
            "met": met_criteria,
            "missed": missed_criteria,
        },
        "deductions": deductions,
    }

    lineage_payload = {
        "rubric_key": rubric_key,
        "rules_applied": [
            row["institution_rule_id"]
            for row in lineage_tracking
            if row.get("institution_rule_id")
        ],
        "lineage_tracking": lineage_tracking,
        "rubric_source_lineage": rubric_source_lineage,
    }

    execute(
        """
        INSERT INTO rubric_lineage_events(student_id, week_tag, rubric_key, question, lineage_json, loss_run_json)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
        """,
        (
            student_id,
            week_tag,
            rubric_key,
            question,
            json_value(lineage_payload),
            json_value(structured_loss_run),
        ),
    )

    return {
        "met_criteria": met_criteria,
        "missed_criteria": missed_criteria,
        "deductions": deductions,
        "structured_loss_run": structured_loss_run,
        "predicted_score": round(awarded_total, 2),
        "max_score": round(max_total, 2),
        "forecast_percentage": round(_safe_div(awarded_total, max_total) * 100, 2),
        "explainable_feedback": explainable_feedback,
        "rewrite_priority_ranked": rewrite_priority_ranked,
        "rubric_lineage_tracking": lineage_tracking,
    }
