import json

import app.rubric_engine as rubric_engine
from app.rubric_engine import RubricCriterion, evaluate_rubric


def test_evaluate_rubric_scores_and_deductions(monkeypatch) -> None:
    writes = []

    monkeypatch.setattr(rubric_engine, "execute", lambda *args, **kwargs: writes.append((args, kwargs)))
    monkeypatch.setattr(rubric_engine, "json_value", lambda payload: json.dumps(payload))

    criteria = [
        RubricCriterion(
            criterion_code="C1",
            criterion="Define transform and data representation",
            max_score=4.0,
            required_keywords=["transform", "data"],
            rule_category="logic",
            institution_rule_id="rule-1",
            lineage_ref="lin-1",
        ),
        RubricCriterion(
            criterion_code="C2",
            criterion="Provide diagram evidence",
            max_score=2.0,
            required_keywords=["diagram", "evidence"],
            rule_category="presentation",
            institution_rule_id="rule-2",
            lineage_ref="lin-2",
        ),
    ]

    out = evaluate_rubric(
        student_id="S1",
        week_tag="week-4",
        rubric_key="wk4-rubric",
        question="Explain transform",
        draft_answer="The transform maps data to another basis with clear steps.",
        criteria=criteria,
        rubric_source_lineage=["week4.pdf#p3:p-42"],
    )

    assert out["predicted_score"] < out["max_score"]
    assert len(out["met_criteria"]) >= 1
    assert len(out["missed_criteria"]) >= 1
    assert len(out["deductions"]) >= 1
    assert writes
