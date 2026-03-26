import app.services.faculty_automation_service as faculty_service
from app.models import AttainmentCalculationRequest


def test_to_float_safe_conversion() -> None:
    assert faculty_service._to_float("3.5") == 3.5
    assert faculty_service._to_float(None, default=1.2) == 1.2


def test_calculate_attainment_uses_overrides(monkeypatch) -> None:
    monkeypatch.setattr(
        faculty_service,
        "fetch_all",
        lambda *args, **kwargs: [
            {"marks_obtained": 70, "max_marks": 100, "co_scores_json": {"CO1": 68}, "po_scores_json": {"PO1": 72}},
            {"marks_obtained": 80, "max_marks": 100, "co_scores_json": {"CO1": 78}, "po_scores_json": {"PO1": 75}},
        ],
    )
    monkeypatch.setattr(
        faculty_service,
        "_load_active_overrides",
        lambda *args, **kwargs: [{"override_payload": {"attainment_percentage": 88.5}}],
    )
    monkeypatch.setattr(faculty_service, "execute", lambda *args, **kwargs: None)
    monkeypatch.setattr(faculty_service, "json_value", lambda payload: str(payload))
    monkeypatch.setattr(faculty_service, "log_event", lambda *args, **kwargs: None)

    response = faculty_service.calculate_attainment(
        AttainmentCalculationRequest(week_tag="week-4", course_code="ECE201", target_attainment_percentage=75.0)
    )

    assert response.attainment_percentage == 88.5
    assert response.compliant is True
    assert response.co_attainment["CO1"] > 0
