from __future__ import annotations

from typing import Any

import httpx

from app.db import execute, fetch_all, fetch_one, json_value
from app.models import LmsWebhookDispatchRequest, LmsWebhookRegistrationRequest, LmsWebhookRegistrationResponse


def register_lms_webhook(request: LmsWebhookRegistrationRequest) -> LmsWebhookRegistrationResponse:
    row = fetch_one(
        """
        INSERT INTO lms_webhooks(event_type, target_url, secret_token, active)
        VALUES (%s, %s, %s, TRUE)
        RETURNING id
        """,
        (request.event_type, request.target_url, request.secret_token or None),
    )
    if not row:
        raise RuntimeError("Failed to register webhook")

    return LmsWebhookRegistrationResponse(
        webhook_id=int(row["id"]),
        event_type=request.event_type,
        target_url=request.target_url,
        active=True,
    )


def list_lms_webhooks(event_type: str | None = None) -> list[dict[str, Any]]:
    if event_type:
        rows = fetch_all(
            """
            SELECT id, event_type, target_url, active, created_at
            FROM lms_webhooks
            WHERE event_type = %s
            ORDER BY created_at DESC
            """,
            (event_type,),
        )
    else:
        rows = fetch_all(
            """
            SELECT id, event_type, target_url, active, created_at
            FROM lms_webhooks
            ORDER BY created_at DESC
            """
        )

    return [
        {
            "webhook_id": int(row.get("id", 0)),
            "event_type": str(row.get("event_type", "")),
            "target_url": str(row.get("target_url", "")),
            "active": bool(row.get("active")),
            "created_at": str(row.get("created_at", "")),
        }
        for row in rows
    ]


def dispatch_lms_webhook_event(request: LmsWebhookDispatchRequest) -> dict[str, Any]:
    rows = fetch_all(
        """
        SELECT id, target_url, secret_token
        FROM lms_webhooks
        WHERE event_type = %s AND active = TRUE
        """,
        (request.event_type,),
    )

    delivered = 0
    failures: list[dict[str, Any]] = []

    for row in rows:
        webhook_id = int(row.get("id", 0))
        target_url = str(row.get("target_url", ""))
        secret = str(row.get("secret_token", "") or "")

        headers = {"Content-Type": "application/json"}
        if secret:
            headers["X-Webhook-Token"] = secret

        body = {
            "event_type": request.event_type,
            "payload": request.payload,
            "webhook_id": webhook_id,
        }

        try:
            resp = httpx.post(target_url, json=body, headers=headers, timeout=8.0)
            if 200 <= resp.status_code < 300:
                delivered += 1
            else:
                failures.append({"webhook_id": webhook_id, "status_code": resp.status_code})
        except Exception as exc:
            failures.append({"webhook_id": webhook_id, "error": str(exc)})

    execute(
        """
        INSERT INTO accreditation_evidence(week_tag, course_code, evidence_type, lineage_json, payload_json)
        VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)
        """,
        (
            str(request.payload.get("week_tag", "")),
            str(request.payload.get("course_code", "")),
            "lms_webhook_dispatch",
            json_value({"event_type": request.event_type}),
            json_value({"delivered": delivered, "failures": failures}),
        ),
    )

    return {
        "event_type": request.event_type,
        "target_count": len(rows),
        "delivered": delivered,
        "failures": failures,
    }
