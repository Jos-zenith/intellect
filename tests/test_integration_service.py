import app.services.integration_service as integration_service
from app.models import LmsWebhookDispatchRequest, LmsWebhookRegistrationRequest


class _FakeResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


def test_register_webhook(monkeypatch) -> None:
    monkeypatch.setattr(integration_service, "fetch_one", lambda *args, **kwargs: {"id": 11})

    resp = integration_service.register_lms_webhook(
        LmsWebhookRegistrationRequest(
            event_type="assessment.updated",
            target_url="https://example.com/hook",
            secret_token="abc",
        )
    )

    assert resp.webhook_id == 11
    assert resp.active is True


def test_dispatch_webhook_collects_failures(monkeypatch) -> None:
    monkeypatch.setattr(
        integration_service,
        "fetch_all",
        lambda *args, **kwargs: [
            {"id": 1, "target_url": "https://ok.test/hook", "secret_token": "tok"},
            {"id": 2, "target_url": "https://bad.test/hook", "secret_token": ""},
        ],
    )

    def _fake_post(url, **kwargs):
        if "ok.test" in url:
            return _FakeResponse(200)
        return _FakeResponse(500)

    monkeypatch.setattr(integration_service.httpx, "post", _fake_post)
    monkeypatch.setattr(integration_service, "execute", lambda *args, **kwargs: None)
    monkeypatch.setattr(integration_service, "json_value", lambda payload: str(payload))

    out = integration_service.dispatch_lms_webhook_event(
        LmsWebhookDispatchRequest(event_type="assessment.updated", payload={"week_tag": "week-4", "course_code": "ECE201"})
    )

    assert out["target_count"] == 2
    assert out["delivered"] == 1
    assert len(out["failures"]) == 1
