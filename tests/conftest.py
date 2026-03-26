from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def api_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    import app.main as main
    import app.api_runtime as api_runtime

    monkeypatch.setattr(main, "init_supabase_schema", lambda: None)
    monkeypatch.setattr(api_runtime, "execute", lambda *args, **kwargs: None)

    with TestClient(main.app, raise_server_exceptions=False) as client:
        yield client
