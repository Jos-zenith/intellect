import asyncio
import time

import httpx
import pytest

import app.main as main


@pytest.mark.asyncio
async def test_concurrent_health_requests(monkeypatch) -> None:
    import app.api_runtime as api_runtime

    monkeypatch.setattr(main, "init_supabase_schema", lambda: None)
    monkeypatch.setattr(api_runtime, "execute", lambda *args, **kwargs: None)

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async def hit() -> float:
            start = time.perf_counter()
            response = await client.get("/api/health")
            assert response.status_code == 200
            return (time.perf_counter() - start) * 1000

        latencies = await asyncio.gather(*[hit() for _ in range(40)])

    p95 = sorted(latencies)[int(0.95 * len(latencies)) - 1]
    assert p95 < 1200
