from datetime import datetime

import app.main as main
from app.models import ExamQuestion, ExamResponse, MondayIngestResponse, TuesdayAlignmentResponse


def test_monday_tuesday_wednesday_cycle(api_client, monkeypatch) -> None:
    monkeypatch.setattr(
        main,
        "monday_ingest_transcript",
        lambda request: MondayIngestResponse(
            week_tag=request.week_tag or "week-5",
            source_label=request.source_label,
            knowledge_revision=3,
            paragraphs_indexed=12,
            date_stamp=request.date_stamp or "2025-08-03",
        ),
    )
    monkeypatch.setattr(
        main,
        "tuesday_align",
        lambda request: TuesdayAlignmentResponse(
            week_tag=request.week_tag,
            knowledge_revision=4,
            topics_analyzed=["fourier transform", "sampling"],
            keyword_weights={"fourier transform": 2.2},
            chunks_updated=8,
            learning_outcomes=["Apply DFT"],
            alignment_report={"drift": 12},
            priority_topic_boosts=["fourier transform"],
        ),
    )
    monkeypatch.setattr(
        main,
        "wednesday_execute",
        lambda request: ExamResponse(
            week_tag=request.week_tag,
            generated_at=datetime.utcnow(),
            questions=[
                ExamQuestion(
                    question="Explain DFT application in noise removal.",
                    answer_key="Transform, filter, inverse transform.",
                    difficulty="Medium",
                    bloom_level="Apply",
                    marks=6,
                    source_lineage=["wk5.pdf#p2:p-11"],
                    rubric_criteria=["Correct flow"],
                )
            ],
        ),
    )

    r1 = api_client.post(
        "/api/orchestrator/monday/transcript",
        json={"transcript_text": "A" * 60, "week_tag": "week-5", "source_label": "live"},
    )
    assert r1.status_code == 200
    assert r1.json()["knowledge_revision"] == 3

    r2 = api_client.post(
        "/api/orchestrator/tuesday/align",
        json={"week_tag": "week-5", "syllabus_text": "B" * 40, "max_topics": 8},
    )
    assert r2.status_code == 200
    assert r2.json()["chunks_updated"] == 8

    r3 = api_client.post(
        "/api/orchestrator/wednesday/execute",
        json={"week_tag": "week-5", "num_questions": 5},
    )
    assert r3.status_code == 200
    assert len(r3.json()["questions"]) == 1
