from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from typing import Any

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app.config import settings
from app.db import execute, fetch_all, json_value


_rate_windows: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = asyncio.Lock()
_usage_counters: dict[str, int] = defaultdict(int)


def _allowed_api_keys() -> set[str]:
    raw = settings.api_keys_csv
    return {token.strip() for token in raw.split(",") if token.strip()}


def _is_bypass_path(path: str) -> bool:
    bypass_prefixes = ["/docs", "/redoc", "/openapi.json", "/api/health"]
    return any(path.startswith(prefix) for prefix in bypass_prefixes)


async def _enforce_rate_limit(client_key: str) -> None:
    now = time.time()
    window_seconds = max(1, settings.api_rate_limit_window_seconds)
    limit = max(1, settings.api_rate_limit_per_minute)

    async with _rate_lock:
        queue = _rate_windows[client_key]
        while queue and (now - queue[0]) > window_seconds:
            queue.popleft()

        if len(queue) >= limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")

        queue.append(now)


def get_usage_snapshot() -> dict[str, Any]:
    usage_rows = fetch_all(
        """
        SELECT path, method, status_code, latency_ms, created_at
        FROM api_usage_metrics
        ORDER BY created_at DESC
        LIMIT 500
        """
    )

    path_stats: dict[str, int] = defaultdict(int)
    errors = 0
    for row in usage_rows:
        key = f"{row.get('method', 'GET')} {row.get('path', '')}"
        path_stats[key] += 1
        if int(row.get("status_code", 200) or 200) >= 400:
            errors += 1

    return {
        "in_memory_counters": dict(_usage_counters),
        "recent_calls": len(usage_rows),
        "recent_errors": errors,
        "top_paths": sorted(path_stats.items(), key=lambda item: item[1], reverse=True)[:15],
    }


class ApiGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Any) -> Response:
        started = time.perf_counter()
        path = request.url.path
        method = request.method.upper()
        client_ip = request.client.host if request.client else "unknown"

        if not _is_bypass_path(path):
            if settings.api_auth_enabled:
                provided = request.headers.get("X-API-Key", "").strip()
                if not provided or provided not in _allowed_api_keys():
                    return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

            try:
                await _enforce_rate_limit(client_key=f"{client_ip}:{method}:{path}")
            except HTTPException as exc:
                return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

        status_code = 500
        try:
            response = await call_next(request)
            status_code = int(response.status_code)
            return response
        finally:
            latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
            _usage_counters[f"{method} {path}"] += 1
            try:
                execute(
                    """
                    INSERT INTO api_usage_metrics(path, method, status_code, latency_ms, client_ip)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (path, method, status_code, latency_ms, client_ip),
                )
            except Exception:
                # Monitoring must not block API availability.
                pass
