import app.services.exam_service as exam_service
from app.models import ExamRequest


def test_exam_service_quality_checks_detects_missing_fields() -> None:
    q1 = exam_service.ExamQuestion(
        question="Explain Fourier transform basics",
        answer_key="",
        difficulty="Medium",
        bloom_level="Understand",
        marks=6,
        source_lineage=[],
        rubric_criteria=[],
    )
    checks = exam_service._quality_checks([q1])
    assert checks["passed"] is False
    assert checks["missing_lineage"] == 1
    assert checks["missing_rubric"] == 1


def test_generate_exam_fallback_when_llm_returns_invalid(monkeypatch) -> None:
    monkeypatch.setattr(
        exam_service,
        "query_context",
        lambda *args, **kwargs: {
            "documents": [["Fourier transform and sampling relation"]],
            "metadatas": [[{"source_file": "wk4.pdf", "page": 2, "paragraph_id": "p-10", "co_tags_csv": "CO1", "po_tags_csv": "PO2"}]],
        },
    )
    monkeypatch.setattr(exam_service, "complete_text", lambda *args, **kwargs: "{bad json")
    monkeypatch.setattr(exam_service, "log_event", lambda *args, **kwargs: None)

    resp = exam_service.generate_exam(ExamRequest(week_tag="week-4", num_questions=3))

    assert len(resp.questions) == 1
    assert resp.questions[0].question.lower().startswith("explain the significance")
    assert resp.quality_checks["missing_answer_key"] == 0
