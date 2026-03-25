from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.audit import recent_events
from app.config import settings
from app.models import (
    AtRiskRequest,
    AtRiskResponse,
    ChatRequest,
    ChatResponse,
    ExamRequest,
    ExamResponse,
    IngestTextRequest,
    IngestTextResponse,
    IngestResponse,
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

app = FastAPI(title="Academic TeamSpace", version="0.1.0")


@app.on_event("startup")
def startup() -> None:
    Path(settings.upload_path).mkdir(parents=True, exist_ok=True)
    Path(settings.chroma_path).mkdir(parents=True, exist_ok=True)
    Path(settings.audit_db_path).parent.mkdir(parents=True, exist_ok=True)


web_path = Path(__file__).resolve().parent.parent / "web"
app.mount("/static", StaticFiles(directory=str(web_path)), name="static")


@app.get("/")
def home() -> FileResponse:
    return FileResponse(web_path / "index.html")


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "openai_configured": bool(settings.openai_api_key),
        "llamaparse_configured": bool(settings.llama_parse_api_key),
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
