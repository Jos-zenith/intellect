import app.services.qa_service as qa_service
from app.models import ChatRequest


def test_qa_no_context_graceful_block(monkeypatch) -> None:
    monkeypatch.setattr(qa_service, "route_persona", lambda _q: ("qa_strategist", "rule"))
    monkeypatch.setattr(qa_service, "ensure_session", lambda *args, **kwargs: {"session_id": "sess-1", "difficulty_level": "foundation"})
    monkeypatch.setattr(qa_service, "choose_socratic_mode", lambda *args, **kwargs: "why")
    monkeypatch.setattr(qa_service, "detect_confusion", lambda *args, **kwargs: (True, ["stuck"], 0.9))
    monkeypatch.setattr(qa_service, "query_context", lambda *args, **kwargs: {"documents": [[]], "metadatas": [[]], "scores": [[]]})
    monkeypatch.setattr(qa_service, "update_session_after_turn", lambda **kwargs: {"turn_count": 1, "confusion_streak": 1, "difficulty_level": "foundation"})
    monkeypatch.setattr(qa_service, "log_event", lambda *args, **kwargs: None)

    response = qa_service.answer_question(ChatRequest(question="What is DFT?", week_tag="week-4"))

    assert "do not have enough grounded material" in response.answer.lower()
    assert response.confusion_detected is True
    assert response.citations == []


def test_qa_enforces_citation_if_missing(monkeypatch) -> None:
    monkeypatch.setattr(qa_service, "route_persona", lambda _q: ("qa_strategist", "rule"))
    monkeypatch.setattr(qa_service, "ensure_session", lambda *args, **kwargs: {"session_id": "sess-2", "difficulty_level": "guided"})
    monkeypatch.setattr(qa_service, "choose_socratic_mode", lambda *args, **kwargs: "bridge")
    monkeypatch.setattr(qa_service, "detect_confusion", lambda *args, **kwargs: (False, [], 0.2))
    monkeypatch.setattr(
        qa_service,
        "query_context",
        lambda *args, **kwargs: {
            "documents": [["Fourier transform represents frequency information."]],
            "metadatas": [[{"source_file": "wk4.pdf", "page": 4, "paragraph_id": "p-1"}]],
            "scores": [[0.9]],
        },
    )
    monkeypatch.setattr(
        qa_service,
        "_generate_tutoring_payload",
        lambda **kwargs: {"answer": "It maps signal into frequency domain.", "guided_correction_pathway": []},
    )
    monkeypatch.setattr(qa_service, "update_session_after_turn", lambda **kwargs: {"turn_count": 2, "confusion_streak": 0, "last_socratic_mode": "bridge", "difficulty_level": "guided"})
    monkeypatch.setattr(qa_service, "log_event", lambda *args, **kwargs: None)

    response = qa_service.answer_question(ChatRequest(question="Explain DFT quickly", week_tag="week-4"))

    assert "[cite:" in response.answer
    assert response.persona
