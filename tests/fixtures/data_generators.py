from __future__ import annotations

from typing import Any


def build_student_profile(student_id: str = "S1", marks: list[float] | None = None) -> dict[str, Any]:
    marks = marks or [72.0, 68.0, 74.0]
    return {
        "student_id": student_id,
        "marks": marks,
        "feedback": "Needs better concept clarity and consistency.",
        "study_habits": "Studies regularly but misses revision cycles.",
        "attendance_ratio": 0.82,
        "days_until_exam": 6,
    }


def build_performance_history(weeks: int = 8) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for idx in range(weeks):
        rows.append(
            {
                "week": f"W{idx + 1:02d}",
                "marks": 60 + idx,
                "attendance_ratio": round(0.75 + (idx * 0.02), 2),
                "risk_flag": idx < 2,
            }
        )
    return rows


def build_vector_context(topic: str = "Fourier Transform") -> dict[str, Any]:
    return {
        "documents": [[f"{topic} converts time-domain signals into frequency-domain representation."]],
        "metadatas": [[{"source_file": "week4-notes.pdf", "page": 3, "paragraph_id": "p-42", "co_tags_csv": "CO1|CO2", "po_tags_csv": "PO1"}]],
        "scores": [[0.82]],
    }
