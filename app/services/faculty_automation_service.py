from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from app.audit import log_event, recent_events
from app.db import execute, fetch_all, fetch_one, json_value
from app.llm import complete_text
from app.models import (
    AccreditationNarrativeRequest,
    AccreditationNarrativeResponse,
    AttainmentCalculationRequest,
    AttainmentCalculationResponse,
    BulkStudentReportRequest,
    BulkStudentReportResponse,
    CieDocumentationRequest,
    CieDocumentationResponse,
    CoPoMappingAutomationRequest,
    CoPoMappingAutomationResponse,
    EvidenceCompilationRequest,
    EvidenceCompilationResponse,
    FacultyDashboardResponse,
    ManualOverrideRequest,
    ManualOverrideResponse,
    BatchStudentOperationRequest,
    BatchStudentOperationResponse,
)
from app.services.integration_service import dispatch_lms_webhook_event
from app.models import LmsWebhookDispatchRequest


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def automate_co_po_mapping(request: CoPoMappingAutomationRequest) -> CoPoMappingAutomationResponse:
    co_po_map: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    insert_count = 0

    for record in request.records:
        execute(
            """
            INSERT INTO internal_assessment_results(
                week_tag, course_code, student_id, marks_obtained, max_marks, co_scores_json, po_scores_json, attendance_ratio, feedback
            )
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
            """,
            (
                request.week_tag,
                request.course_code,
                record.student_id,
                record.marks_obtained,
                record.max_marks,
                json_value(record.co_scores),
                json_value(record.po_scores),
                record.attendance_ratio,
                record.feedback,
            ),
        )
        insert_count += 1

        for co_tag, co_score in record.co_scores.items():
            for po_tag, po_score in record.po_scores.items():
                weight = (_to_float(co_score) * _to_float(po_score)) / 100.0
                co_po_map[co_tag][po_tag] += weight

    mapping_summary: dict[str, dict[str, float]] = {}
    for co_tag, po_weights in co_po_map.items():
        mapping_summary[co_tag] = {}
        for po_tag, weight in po_weights.items():
            normalized = round(weight / max(len(request.records), 1), 3)
            mapping_summary[co_tag][po_tag] = normalized
            execute(
                """
                INSERT INTO co_po_mappings(course_code, co_tag, po_tag, weight, week_tag)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (request.course_code, co_tag, po_tag, normalized, request.week_tag),
            )

    log_event(
        "faculty.copo.automap.completed",
        {
            "week_tag": request.week_tag,
            "course_code": request.course_code,
            "records_processed": len(request.records),
            "mappings_upserted": sum(len(v) for v in mapping_summary.values()),
            "mapping_summary": mapping_summary,
        },
    )

    return CoPoMappingAutomationResponse(
        week_tag=request.week_tag,
        course_code=request.course_code,
        mapping_summary=mapping_summary,
        mappings_upserted=sum(len(v) for v in mapping_summary.values()),
    )


def _load_active_overrides(week_tag: str, course_code: str, scope: str) -> list[dict[str, Any]]:
    return fetch_all(
        """
        SELECT id, scope, reference_id, override_payload, reviewer, status
        FROM faculty_overrides
        WHERE week_tag = %s AND course_code = %s AND scope = %s AND status = 'applied'
        ORDER BY updated_at DESC
        """,
        (week_tag, course_code, scope),
    )


def calculate_attainment(request: AttainmentCalculationRequest) -> AttainmentCalculationResponse:
    rows = fetch_all(
        """
        SELECT marks_obtained, max_marks, co_scores_json, po_scores_json
        FROM internal_assessment_results
        WHERE week_tag = %s AND course_code = %s
        """,
        (request.week_tag, request.course_code),
    )

    if not rows:
        return AttainmentCalculationResponse(
            week_tag=request.week_tag,
            course_code=request.course_code,
            attainment_percentage=0.0,
            co_attainment={},
            po_attainment={},
            compliant=False,
        )

    total_marks = sum(_to_float(r.get("marks_obtained")) for r in rows)
    total_max = sum(_to_float(r.get("max_marks"), 1.0) for r in rows)
    attainment_percentage = round((total_marks / max(total_max, 1.0)) * 100.0, 2)

    co_acc: dict[str, list[float]] = defaultdict(list)
    po_acc: dict[str, list[float]] = defaultdict(list)

    for row in rows:
        co_scores = row.get("co_scores_json") or {}
        po_scores = row.get("po_scores_json") or {}
        if isinstance(co_scores, dict):
            for key, value in co_scores.items():
                co_acc[str(key)].append(_to_float(value))
        if isinstance(po_scores, dict):
            for key, value in po_scores.items():
                po_acc[str(key)].append(_to_float(value))

    co_attainment = {k: round(sum(v) / max(len(v), 1), 2) for k, v in co_acc.items()}
    po_attainment = {k: round(sum(v) / max(len(v), 1), 2) for k, v in po_acc.items()}

    for override in _load_active_overrides(request.week_tag, request.course_code, "attainment"):
        payload = override.get("override_payload")
        if isinstance(payload, dict):
            if "attainment_percentage" in payload:
                attainment_percentage = round(_to_float(payload.get("attainment_percentage"), attainment_percentage), 2)
            if "co_attainment" in payload and isinstance(payload.get("co_attainment"), dict):
                co_attainment.update({str(k): _to_float(v) for k, v in payload["co_attainment"].items()})
            if "po_attainment" in payload and isinstance(payload.get("po_attainment"), dict):
                po_attainment.update({str(k): _to_float(v) for k, v in payload["po_attainment"].items()})

    compliant = attainment_percentage >= request.target_attainment_percentage

    execute(
        """
        INSERT INTO attainment_records(
            week_tag, course_code, attainment_percentage, co_attainment_json, po_attainment_json, target_percentage, compliant
        )
        VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)
        """,
        (
            request.week_tag,
            request.course_code,
            attainment_percentage,
            json_value(co_attainment),
            json_value(po_attainment),
            request.target_attainment_percentage,
            compliant,
        ),
    )

    log_event(
        "faculty.attainment.completed",
        {
            "week_tag": request.week_tag,
            "course_code": request.course_code,
            "attainment_percentage": attainment_percentage,
            "target_attainment_percentage": request.target_attainment_percentage,
            "compliant": compliant,
        },
    )

    return AttainmentCalculationResponse(
        week_tag=request.week_tag,
        course_code=request.course_code,
        attainment_percentage=attainment_percentage,
        co_attainment=co_attainment,
        po_attainment=po_attainment,
        compliant=compliant,
    )


def generate_cie_document(request: CieDocumentationRequest) -> CieDocumentationResponse:
    attainment = calculate_attainment(
        AttainmentCalculationRequest(
            week_tag=request.week_tag,
            course_code=request.course_code,
            target_attainment_percentage=60.0,
        )
    )

    cie_doc = (
        f"CIE REPORT\n"
        f"Week: {request.week_tag}\n"
        f"Course: {request.course_code}\n"
        f"Faculty: {request.faculty_name}\n"
        f"Generated: {datetime.utcnow().isoformat()}\n\n"
        f"Overall Attainment: {attainment.attainment_percentage}%\n"
        f"Compliance: {'YES' if attainment.compliant else 'NO'}\n"
        f"CO Attainment: {attainment.co_attainment}\n"
        f"PO Attainment: {attainment.po_attainment}\n"
        "\nRecommended Follow-ups:\n"
        "1. Conduct remedial session for low attainment CO tags.\n"
        "2. Reassess with short internal quiz in 7 days.\n"
    )

    log_event(
        "faculty.cie.generated",
        {
            "week_tag": request.week_tag,
            "course_code": request.course_code,
            "faculty_name": request.faculty_name,
        },
    )

    return CieDocumentationResponse(
        week_tag=request.week_tag,
        course_code=request.course_code,
        cie_document=cie_doc,
    )


def generate_accreditation_narrative(request: AccreditationNarrativeRequest) -> AccreditationNarrativeResponse:
    attainment_rows = fetch_all(
        """
        SELECT attainment_percentage, compliant, created_at
        FROM attainment_records
        WHERE week_tag = %s AND course_code = %s
        ORDER BY created_at DESC
        LIMIT 6
        """,
        (request.week_tag, request.course_code),
    )

    summary = {
        "recent_attainment": [float(r.get("attainment_percentage", 0.0) or 0.0) for r in attainment_rows],
        "compliance_runs": len([r for r in attainment_rows if bool(r.get("compliant"))]),
        "total_runs": len(attainment_rows),
    }

    system_prompt = (
        "Write a concise accreditation self-study narrative for outcome-based education evidence. "
        "Highlight attainment trend, interventions, and continuous improvement actions."
    )
    user_prompt = f"Framework: {request.framework}\nWeek: {request.week_tag}\nCourse: {request.course_code}\nSummary: {summary}"
    narrative = complete_text(system_prompt, user_prompt, temperature=0.1)

    execute(
        """
        INSERT INTO accreditation_evidence(week_tag, course_code, evidence_type, lineage_json, payload_json)
        VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)
        """,
        (
            request.week_tag,
            request.course_code,
            "self_study_narrative",
            json_value({"source": "attainment_records", "framework": request.framework}),
            json_value({"narrative": narrative, "summary": summary}),
        ),
    )

    log_event(
        "faculty.accreditation.narrative.generated",
        {
            "week_tag": request.week_tag,
            "course_code": request.course_code,
            "framework": request.framework,
        },
    )

    return AccreditationNarrativeResponse(
        week_tag=request.week_tag,
        course_code=request.course_code,
        framework=request.framework,
        narrative=narrative,
    )


def predict_at_risk_6_to_8_weeks(week_tag: str, course_code: str) -> list[dict[str, Any]]:
    rows = fetch_all(
        """
        SELECT student_id, marks_obtained, max_marks, attendance_ratio, feedback
        FROM internal_assessment_results
        WHERE week_tag = %s AND course_code = %s
        """,
        (week_tag, course_code),
    )

    output: list[dict[str, Any]] = []
    for row in rows:
        marks = _to_float(row.get("marks_obtained"))
        max_marks = max(_to_float(row.get("max_marks"), 1.0), 1.0)
        score_pct = (marks / max_marks) * 100.0

        attendance = row.get("attendance_ratio")
        attendance_ratio = _to_float(attendance, 0.75) if attendance is not None else 0.75

        feedback = str(row.get("feedback", "")).lower()
        risk = 0.0
        risk += max(0.0, (65.0 - score_pct) / 65.0) * 0.6
        risk += max(0.0, (0.75 - attendance_ratio) / 0.75) * 0.25
        if any(token in feedback for token in {"weak", "incomplete", "missing", "confused"}):
            risk += 0.15

        risk_score = round(min(1.0, risk), 3)
        if risk_score < 0.35:
            continue

        recommendations = [
            "Assign remedial concept drill (30 mins, twice weekly).",
            "Schedule peer-assisted problem-solving session.",
            "Run weekly formative mini-quiz with feedback loop.",
        ]
        if risk_score >= 0.65:
            recommendations.insert(0, "Escalate to faculty mentor and parent update within 7 days.")

        output.append(
            {
                "student_id": str(row.get("student_id", "")),
                "risk_score": risk_score,
                "time_horizon_weeks": "6-8",
                "recommendations": recommendations,
            }
        )

    output.sort(key=lambda x: float(x["risk_score"]), reverse=True)
    return output


def generate_bulk_student_reports(request: BulkStudentReportRequest) -> BulkStudentReportResponse:
    rows = fetch_all(
        """
        SELECT student_id, marks_obtained, max_marks, co_scores_json, po_scores_json, attendance_ratio, feedback
        FROM internal_assessment_results
        WHERE week_tag = %s AND course_code = %s
        """,
        (request.week_tag, request.course_code),
    )

    selected_ids = set(request.student_ids or [])
    reports: list[dict[str, Any]] = []
    for row in rows:
        student_id = str(row.get("student_id", ""))
        if selected_ids and student_id not in selected_ids:
            continue

        marks = _to_float(row.get("marks_obtained"))
        max_marks = max(_to_float(row.get("max_marks"), 1.0), 1.0)
        pct = round((marks / max_marks) * 100.0, 2)

        risk_items = predict_at_risk_6_to_8_weeks(request.week_tag, request.course_code)
        risk_lookup = {item["student_id"]: item for item in risk_items}

        report = {
            "student_id": student_id,
            "score_percentage": pct,
            "co_scores": row.get("co_scores_json") or {},
            "po_scores": row.get("po_scores_json") or {},
            "attendance_ratio": _to_float(row.get("attendance_ratio"), 0.0),
            "feedback": str(row.get("feedback", "")),
            "at_risk_prediction": risk_lookup.get(student_id, {"risk_score": 0.0, "recommendations": []}),
        }
        reports.append(report)

    log_event(
        "faculty.bulk_reports.generated",
        {
            "week_tag": request.week_tag,
            "course_code": request.course_code,
            "generated_count": len(reports),
        },
    )

    dispatch_lms_webhook_event(
        LmsWebhookDispatchRequest(
            event_type="faculty.bulk_reports.generated",
            payload={
                "week_tag": request.week_tag,
                "course_code": request.course_code,
                "generated_count": len(reports),
            },
        )
    )

    return BulkStudentReportResponse(
        week_tag=request.week_tag,
        course_code=request.course_code,
        generated_count=len(reports),
        reports=reports,
    )


def compile_accreditation_evidence(request: EvidenceCompilationRequest) -> EvidenceCompilationResponse:
    rows = fetch_all(
        """
        SELECT id, evidence_type, lineage_json, payload_json, created_at
        FROM accreditation_evidence
        WHERE week_tag = %s AND course_code = %s
        ORDER BY created_at DESC
        """,
        (request.week_tag, request.course_code),
    )

    lineage = [
        {
            "evidence_id": int(row.get("id", 0)),
            "evidence_type": str(row.get("evidence_type", "")),
            "created_at": str(row.get("created_at", "")),
            "lineage": row.get("lineage_json") if isinstance(row.get("lineage_json"), dict) else {},
        }
        for row in rows
    ]

    log_event(
        "faculty.evidence.compiled",
        {
            "week_tag": request.week_tag,
            "course_code": request.course_code,
            "evidence_count": len(lineage),
        },
    )

    return EvidenceCompilationResponse(
        week_tag=request.week_tag,
        course_code=request.course_code,
        evidence_count=len(lineage),
        lineage=lineage,
    )


def get_faculty_dashboard(week_tag: str, course_code: str) -> FacultyDashboardResponse:
    recent = recent_events(limit=1200)

    automation_events = [
        ev for ev in recent
        if str(ev.get("event_type", "")).startswith("faculty.")
        and (not week_tag or str((ev.get("payload", {}) or {}).get("week_tag", "")) == week_tag)
    ]

    auto_count = len(automation_events)
    hours_saved_estimate = round(auto_count * 0.35, 2)

    attainment = fetch_one(
        """
        SELECT attainment_percentage, compliant
        FROM attainment_records
        WHERE week_tag = %s AND course_code = %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (week_tag, course_code),
    )

    pending_actions: list[str] = []
    if not attainment:
        pending_actions.append("Run attainment calculation for current assessment cycle.")
    else:
        if not bool(attainment.get("compliant")):
            pending_actions.append("Attainment below target. Review remedial interventions.")

    risk_list = predict_at_risk_6_to_8_weeks(week_tag, course_code)
    if risk_list:
        pending_actions.append(f"{len(risk_list)} students predicted at risk. Assign remedial pathways.")

    overrides = fetch_all(
        """
        SELECT id
        FROM faculty_overrides
        WHERE week_tag = %s AND course_code = %s
        """,
        (week_tag, course_code),
    )

    metrics = {
        "automation_event_count": auto_count,
        "manual_override_count": len(overrides),
        "risk_student_count": len(risk_list),
        "latest_attainment_percentage": _to_float(attainment.get("attainment_percentage"), 0.0) if attainment else 0.0,
    }

    return FacultyDashboardResponse(
        week_tag=week_tag,
        hours_saved_estimate=hours_saved_estimate,
        pending_actions=pending_actions,
        pending_action_count=len(pending_actions),
        automation_metrics=metrics,
    )


def apply_manual_override(request: ManualOverrideRequest) -> ManualOverrideResponse:
    row = fetch_one(
        """
        INSERT INTO faculty_overrides(week_tag, course_code, scope, reference_id, override_payload, reviewer, status)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s, 'applied')
        RETURNING id
        """,
        (
            request.week_tag,
            request.course_code,
            request.scope,
            request.reference_id,
            json_value(request.override_payload),
            request.reviewer,
        ),
    )
    if not row:
        raise RuntimeError("Failed to apply manual override")

    override_id = int(row.get("id", 0))
    log_event(
        "faculty.override.applied",
        {
            "override_id": override_id,
            "week_tag": request.week_tag,
            "course_code": request.course_code,
            "scope": request.scope,
            "reference_id": request.reference_id,
            "reviewer": request.reviewer,
        },
    )

    return ManualOverrideResponse(override_id=override_id, status="applied")


def run_batch_student_operation(request: BatchStudentOperationRequest) -> BatchStudentOperationResponse:
    operation = request.operation.strip().lower()

    if operation == "risk_and_reports":
        risk_items = predict_at_risk_6_to_8_weeks(request.week_tag, request.course_code)
        reports = generate_bulk_student_reports(
            BulkStudentReportRequest(
                week_tag=request.week_tag,
                course_code=request.course_code,
                student_ids=request.student_ids,
            )
        )
        return BatchStudentOperationResponse(
            week_tag=request.week_tag,
            course_code=request.course_code,
            operation=operation,
            processed_count=reports.generated_count,
            result={"risk_predictions": risk_items, "reports": reports.reports},
        )

    if operation == "reports_only":
        reports = generate_bulk_student_reports(
            BulkStudentReportRequest(
                week_tag=request.week_tag,
                course_code=request.course_code,
                student_ids=request.student_ids,
            )
        )
        return BatchStudentOperationResponse(
            week_tag=request.week_tag,
            course_code=request.course_code,
            operation=operation,
            processed_count=reports.generated_count,
            result={"reports": reports.reports},
        )

    return BatchStudentOperationResponse(
        week_tag=request.week_tag,
        course_code=request.course_code,
        operation=operation,
        processed_count=0,
        result={"message": "Unknown operation"},
    )
