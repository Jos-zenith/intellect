import app.main as main


def test_chat_endpoint_graceful_error_payload(api_client, monkeypatch) -> None:
    def _boom(_request):
        raise RuntimeError("simulated backend failure")

    monkeypatch.setattr(main, "answer_question", _boom)

    response = api_client.post("/api/chat", json={"question": "Explain this topic", "week_tag": "week-2"})

    assert response.status_code == 500
    body = response.json()
    assert body["error"] == "internal_server_error"
    assert "simulated backend failure" in body["detail"]
