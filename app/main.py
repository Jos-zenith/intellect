from pathlib import Path
import csv
import io
import time
import logging

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.audit import recent_events
from app.config import settings
from app.db import init_supabase_schema
from app.models import (
    AccreditationNarrativeRequest,
    AccreditationNarrativeResponse,
    AtRiskRequest,
    AtRiskResponse,
    AttainmentCalculationRequest,
    AttainmentCalculationResponse,
    BulkStudentReportRequest,
    BulkStudentReportResponse,
    BatchStudentOperationRequest,
    BatchStudentOperationResponse,
    ChatRequest,
    ChatResponse,
    CieDocumentationRequest,
    CieDocumentationResponse,
    CoPoMappingAutomationRequest,
    CoPoMappingAutomationResponse,
    EvidenceCompilationRequest,
    EvidenceCompilationResponse,
    ExamRequest,
    ExamResponse,
    FacultyDashboardResponse,
    IngestTextRequest,
    IngestTextResponse,
    IngestResponse,
    LmsWebhookDispatchRequest,
    LmsWebhookRegistrationRequest,
    LmsWebhookRegistrationResponse,
    ManualOverrideRequest,
    ManualOverrideResponse,
    MondayStreamResponse,
    MondayTranscriptStreamRequest,
    MondayIngestRequest,
    MondayIngestResponse,
    RubricGpsRequest,
    RubricGpsResponse,
    RouterRequest,
    RouterResponse,
    TuesdayAlignmentRequest,
    TuesdayAlignmentResponse,
    WednesdayExecutionRequest,
)
from app.services.agile_rag_service import (
    get_knowledge_versions,
    monday_ingest_audio,
    monday_ingest_transcript,
    predict_at_risk_students,
    route_student_profile,
    run_rubric_gps,
    tuesday_align,
    wednesday_execute,
)
from app.services.exam_service import generate_exam
from app.services.ingestion_service import ingest_pdf, ingest_text
from app.services.qa_service import answer_question
from app.services.stream_ingestion_service import ingest_audio_stream_chunk, ingest_transcript_stream_chunk
from app.api_runtime import ApiGuardMiddleware, get_usage_snapshot
from app.services.faculty_automation_service import (
    apply_manual_override,
    automate_co_po_mapping,
    calculate_attainment,
    compile_accreditation_evidence,
    generate_accreditation_narrative,
    generate_bulk_student_reports,
    generate_cie_document,
    get_faculty_dashboard,
    predict_at_risk_6_to_8_weeks,
    run_batch_student_operation,
)
from app.services.integration_service import dispatch_lms_webhook_event, list_lms_webhooks, register_lms_webhook

app = FastAPI(
    title="Academic TeamSpace",
    version="1.0.0",
    description="Enterprise academic operations API with grounded tutoring, AQPGS exam generation, and faculty automation.",
)
_APP_STARTED_AT = time.time()
logger = logging.getLogger(__name__)

app.add_middleware(ApiGuardMiddleware)


@app.on_event("startup")
def startup() -> None:
    Path(settings.upload_path).mkdir(parents=True, exist_ok=True)
    Path(settings.chroma_path).mkdir(parents=True, exist_ok=True)
    try:
        init_supabase_schema()
    except Exception as exc:
        if settings.allow_start_without_db:
            logger.warning("Startup continuing without database initialization: %s", exc)
        else:
            raise


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": "request_validation_failed",
            "detail": exc.errors(),
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "http_error", "detail": exc.detail},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error", "detail": str(exc)},
    )


web_path = Path(__file__).resolve().parent.parent / "web"
app.mount("/static", StaticFiles(directory=str(web_path)), name="static")


@app.get("/")
def home() -> FileResponse:
    return FileResponse(web_path / "index.html")


@app.get("/api/health")
def health() -> dict:
    supabase_configured = bool(settings.supabase_database_url) or bool(
        settings.supabase_db_host and settings.supabase_db_name and settings.supabase_db_user
    )
    return {
        "status": "ok",
        "openai_configured": bool(settings.openai_api_key),
        "llamaparse_configured": bool(settings.llama_parse_api_key),
        "supabase_configured": supabase_configured,
    }


@app.get("/api/health/detailed")
def health_detailed() -> dict:
    from app.db import fetch_one

    db_ok = False
    try:
        row = fetch_one("SELECT 1 AS ok")
        db_ok = bool(row and int(row.get("ok", 0)) == 1)
    except Exception:
        db_ok = False

    return {
        "status": "ok" if db_ok else "degraded",
        "uptime_seconds": round(time.time() - _APP_STARTED_AT, 2),
        "system": {
            "database_ok": db_ok,
            "chroma_path": settings.chroma_path,
            "upload_path": settings.upload_path,
            "openai_configured": bool(settings.openai_api_key),
            "llamaparse_configured": bool(settings.llama_parse_api_key),
        },
    }


@app.post("/api/ingest", response_model=IngestResponse)
async def ingest(file: UploadFile = File(...), week_tag: str | None = Form(None)) -> IngestResponse:
    payload = await file.read()
    safe_name = file.filename or "uploaded-note.pdf"
    return ingest_pdf(safe_name, payload, week_tag=week_tag)


@app.post("/api/ingest/text", response_model=IngestTextResponse)
def ingest_raw_text(request: IngestTextRequest) -> IngestTextResponse:
    return ingest_text(request)


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    return answer_question(request)


@app.post("/api/orchestrator/monday/transcript", response_model=MondayIngestResponse)
def orchestrator_monday_transcript(request: MondayIngestRequest) -> MondayIngestResponse:
    return monday_ingest_transcript(request)


@app.post("/api/orchestrator/monday/audio", response_model=MondayIngestResponse)
async def orchestrator_monday_audio(file: UploadFile = File(...), week_tag: str | None = Form(None)) -> MondayIngestResponse:
    payload = await file.read()
    safe_name = file.filename or "monday-audio.wav"
    return monday_ingest_audio(safe_name, payload, week_tag=week_tag)


@app.post("/api/orchestrator/monday/stream/transcript", response_model=MondayStreamResponse)
def orchestrator_monday_stream_transcript(request: MondayTranscriptStreamRequest) -> MondayStreamResponse:
    return ingest_transcript_stream_chunk(request)


@app.post("/api/orchestrator/monday/stream/audio", response_model=MondayStreamResponse)
async def orchestrator_monday_stream_audio(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    week_tag: str | None = Form(None),
    source_label: str | None = Form(None),
    date_stamp: str | None = Form(None),
    is_final: bool = Form(False),
) -> MondayStreamResponse:
    payload = await file.read()
    safe_name = file.filename or "monday-stream.wav"
    return ingest_audio_stream_chunk(
        session_id=session_id,
        file_name=safe_name,
        audio_chunk=payload,
        week_tag=week_tag,
        source_label=source_label,
        date_stamp=date_stamp,
        is_final=is_final,
    )


@app.post("/api/orchestrator/tuesday/align", response_model=TuesdayAlignmentResponse)
def orchestrator_tuesday_align(request: TuesdayAlignmentRequest) -> TuesdayAlignmentResponse:
    return tuesday_align(request)


@app.post("/api/orchestrator/wednesday/execute", response_model=ExamResponse)
def orchestrator_wednesday_execute(request: WednesdayExecutionRequest) -> ExamResponse:
    return wednesday_execute(request)


@app.post("/api/orchestrator/router", response_model=RouterResponse)
def orchestrator_router(request: RouterRequest) -> RouterResponse:
    return route_student_profile(request)


@app.post("/api/rubric/gps", response_model=RubricGpsResponse)
def rubric_gps(request: RubricGpsRequest) -> RubricGpsResponse:
    return run_rubric_gps(request)


@app.post("/api/analytics/at-risk", response_model=AtRiskResponse)
def at_risk(request: AtRiskRequest) -> AtRiskResponse:
    return predict_at_risk_students(request)


@app.get("/api/orchestrator/versions")
def orchestrator_versions(week_tag: str | None = None, limit: int = 50) -> list[dict]:
    return get_knowledge_versions(week_tag=week_tag, limit=limit)


@app.post("/api/exam/generate", response_model=ExamResponse)
def exam(request: ExamRequest) -> ExamResponse:
    return generate_exam(request)


@app.get("/api/audit/recent")
def audit(limit: int = 50) -> list[dict]:
    return recent_events(limit=limit)


@app.get("/api/v1/health")
def health_v1() -> dict:
    return health()


@app.post("/api/v1/chat", response_model=ChatResponse)
def chat_v1(request: ChatRequest) -> ChatResponse:
    return chat(request)


@app.post("/api/v1/orchestrator/tuesday/align", response_model=TuesdayAlignmentResponse)
def orchestrator_tuesday_align_v1(request: TuesdayAlignmentRequest) -> TuesdayAlignmentResponse:
    return orchestrator_tuesday_align(request)


@app.post("/api/v1/exam/generate", response_model=ExamResponse)
def exam_v1(request: ExamRequest) -> ExamResponse:
    return exam(request)


@app.post("/api/faculty/copo/automap", response_model=CoPoMappingAutomationResponse)
def faculty_copo_automap(request: CoPoMappingAutomationRequest) -> CoPoMappingAutomationResponse:
    return automate_co_po_mapping(request)


@app.post("/api/faculty/attainment/calculate", response_model=AttainmentCalculationResponse)
def faculty_attainment(request: AttainmentCalculationRequest) -> AttainmentCalculationResponse:
    return calculate_attainment(request)


@app.post("/api/faculty/cie/generate", response_model=CieDocumentationResponse)
def faculty_cie(request: CieDocumentationRequest) -> CieDocumentationResponse:
    return generate_cie_document(request)


@app.post("/api/faculty/accreditation/narrative", response_model=AccreditationNarrativeResponse)
def faculty_narrative(request: AccreditationNarrativeRequest) -> AccreditationNarrativeResponse:
    return generate_accreditation_narrative(request)


@app.get("/api/faculty/risk/predict")
def faculty_predict_risk(week_tag: str, course_code: str) -> list[dict]:
    return predict_at_risk_6_to_8_weeks(week_tag=week_tag, course_code=course_code)


@app.post("/api/faculty/reports/bulk", response_model=BulkStudentReportResponse)
def faculty_bulk_reports(request: BulkStudentReportRequest) -> BulkStudentReportResponse:
    return generate_bulk_student_reports(request)


@app.post("/api/faculty/students/batch", response_model=BatchStudentOperationResponse)
def faculty_batch_students(request: BatchStudentOperationRequest) -> BatchStudentOperationResponse:
    return run_batch_student_operation(request)


@app.post("/api/faculty/evidence/compile", response_model=EvidenceCompilationResponse)
def faculty_evidence(request: EvidenceCompilationRequest) -> EvidenceCompilationResponse:
    return compile_accreditation_evidence(request)


@app.get("/api/faculty/dashboard", response_model=FacultyDashboardResponse)
def faculty_dashboard(week_tag: str, course_code: str) -> FacultyDashboardResponse:
    return get_faculty_dashboard(week_tag=week_tag, course_code=course_code)


@app.post("/api/faculty/override", response_model=ManualOverrideResponse)
def faculty_override(request: ManualOverrideRequest) -> ManualOverrideResponse:
    return apply_manual_override(request)


@app.post("/api/integrations/lms/webhooks", response_model=LmsWebhookRegistrationResponse)
def lms_register_webhook(request: LmsWebhookRegistrationRequest) -> LmsWebhookRegistrationResponse:
    return register_lms_webhook(request)


@app.get("/api/integrations/lms/webhooks")
def lms_list_webhooks(event_type: str | None = None) -> list[dict]:
    return list_lms_webhooks(event_type=event_type)


@app.post("/api/integrations/lms/notify")
def lms_notify(request: LmsWebhookDispatchRequest) -> dict:
    return dispatch_lms_webhook_event(request)


@app.get("/api/export/audit", response_model=None)
def export_audit(limit: int = 500, format: str = "json") -> JSONResponse | PlainTextResponse:
    events = recent_events(limit=limit)
    if format.lower() == "csv":
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(["id", "created_at", "event_type", "payload_json"])
        for event in events:
            writer.writerow([event.get("id"), event.get("created_at"), event.get("event_type"), str(event.get("payload", {}))])
        return PlainTextResponse(content=stream.getvalue(), media_type="text/csv")
    return JSONResponse(content={"count": len(events), "items": events})


@app.get("/api/export/accreditation", response_model=None)
def export_accreditation(week_tag: str, course_code: str, format: str = "json") -> JSONResponse | PlainTextResponse:
    evidence = compile_accreditation_evidence(EvidenceCompilationRequest(week_tag=week_tag, course_code=course_code))
    if format.lower() == "csv":
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(["evidence_id", "evidence_type", "created_at", "lineage"])
        for item in evidence.lineage:
            writer.writerow([item.get("evidence_id"), item.get("evidence_type"), item.get("created_at"), str(item.get("lineage", {}))])
        return PlainTextResponse(content=stream.getvalue(), media_type="text/csv")
    return JSONResponse(content=evidence.model_dump())


@app.get("/api/monitoring/usage")
def monitoring_usage() -> dict:
    return get_usage_snapshot()
