from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import List


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Citation(StrictBaseModel):
    paragraph_id: str
    source_file: str
    page: int
    lineage_link: str


class ChatRequest(StrictBaseModel):
    question: str = Field(min_length=3)
    week_tag: str | None = None
    session_id: str | None = None
    student_id: str | None = None


class ChatResponse(StrictBaseModel):
    persona: str
    answer: str
    citations: List[Citation]
    routed_by: str
    session_id: str = ""
    socratic_mode: str = "why"
    confusion_detected: bool = False
    confusion_signals: List[str] = Field(default_factory=list)
    conceptual_bridge: str = ""
    difficulty_level: str = "foundation"
    guided_correction_pathway: List[str] = Field(default_factory=list)
    analogy: str = ""
    transfer_scenario: str = ""
    continuity_state: dict = Field(default_factory=dict)


class ExamRequest(StrictBaseModel):
    week_tag: str
    num_questions: int = Field(default=10, ge=3, le=25)


class ExamQuestion(StrictBaseModel):
    question: str
    answer_key: str
    difficulty: str
    bloom_level: str
    marks: int = 0
    expected_response_structure: List[str] = Field(default_factory=list)
    rubric_criteria: List[str] = Field(default_factory=list)
    source_lineage: List[str]
    co_tags: List[str] = Field(default_factory=list)
    po_tags: List[str] = Field(default_factory=list)


class ExamResponse(StrictBaseModel):
    week_tag: str
    generated_at: datetime
    questions: List[ExamQuestion]
    marks_distribution: dict[str, int] = Field(default_factory=dict)
    bloom_distribution: dict[str, int] = Field(default_factory=dict)
    quality_checks: dict = Field(default_factory=dict)


class IngestResponse(StrictBaseModel):
    file_name: str
    week_tag: str
    pages_parsed: int
    paragraphs_indexed: int
    source_type: str = "lecture_pdf"
    knowledge_revision: int | None = None
    date_stamp: str | None = None


class IngestTextRequest(StrictBaseModel):
    source_label: str = "lecture-transcript"
    text: str = Field(min_length=30)
    week_tag: str | None = None
    date_stamp: str | None = None
    source_type: str = "raw_text"


class IngestTextResponse(StrictBaseModel):
    source_label: str
    week_tag: str
    date_stamp: str
    paragraphs_indexed: int
    knowledge_revision: int


class MondayIngestRequest(StrictBaseModel):
    transcript_text: str = Field(min_length=30)
    week_tag: str | None = None
    source_label: str = "monday-lecture"
    date_stamp: str | None = None


class MondayIngestResponse(StrictBaseModel):
    week_tag: str
    source_label: str
    knowledge_revision: int
    paragraphs_indexed: int
    date_stamp: str


class MondayTranscriptStreamRequest(StrictBaseModel):
    session_id: str = Field(min_length=3)
    transcript_chunk: str = Field(min_length=1)
    week_tag: str | None = None
    source_label: str = "monday-lecture-stream"
    date_stamp: str | None = None
    is_final: bool = False


class MondayStreamResponse(StrictBaseModel):
    session_id: str
    week_tag: str
    source_label: str
    date_stamp: str
    transcript_chunks: int
    audio_chunks: int
    transcript_chars: int
    audio_bytes: int
    is_final: bool = False
    knowledge_revision: int | None = None
    paragraphs_indexed: int | None = None


class TuesdayAlignmentRequest(StrictBaseModel):
    week_tag: str
    syllabus_text: str = Field(min_length=30)
    past_paper_text: str = ""
    max_topics: int = Field(default=12, ge=3, le=30)


class TuesdayAlignmentResponse(StrictBaseModel):
    week_tag: str
    knowledge_revision: int
    topics_analyzed: List[str]
    keyword_weights: dict[str, float]
    chunks_updated: int
    learning_outcomes: List[str] = Field(default_factory=list)
    alignment_report: dict = Field(default_factory=dict)
    priority_topic_boosts: List[str] = Field(default_factory=list)
    before_snapshot_id: int | None = None
    after_snapshot_id: int | None = None
    taught_not_in_syllabus: List[str] = Field(default_factory=list)
    syllabus_not_covered: List[str] = Field(default_factory=list)
    past_paper_priority_topics: List[str] = Field(default_factory=list)
    drift_score: float = 0.0


class WednesdayExecutionRequest(StrictBaseModel):
    week_tag: str
    num_questions: int = Field(default=10, ge=3, le=25)


class StudentPerformanceProfile(StrictBaseModel):
    student_id: str = ""
    marks: List[float] = Field(default_factory=list)
    feedback: str = ""
    study_habits: str = ""
    attendance_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    preparation_window_days: int | None = Field(default=None, ge=0, le=60)
    days_until_exam: int | None = Field(default=None, ge=0, le=60)


class RouterRequest(StrictBaseModel):
    week_tag: str | None = None
    profile: StudentPerformanceProfile
    goal: str = "Improve Wednesday exam outcomes"


class RouterResponse(StrictBaseModel):
    agent_id: str
    agent_name: str
    rationale: str
    routed_by: str
    action_plan: str
    routing_evidence: dict
    structured_loss_run: dict | None = None
    specialist_payload: dict | None = None


class RubricGpsRequest(StrictBaseModel):
    student_id: str = Field(min_length=2)
    week_tag: str
    question: str = Field(min_length=5)
    draft_answer: str = Field(min_length=20)
    unit_tag: str | None = None


class RubricCriterionScore(StrictBaseModel):
    criterion: str
    met: bool
    confidence: float
    explanation: str
    required_keywords: List[str]
    matched_keywords: List[str]


class RubricGpsResponse(StrictBaseModel):
    student_id: str
    week_tag: str
    question: str
    rubric_source_lineage: List[str]
    met_criteria: List[RubricCriterionScore]
    missed_criteria: List[RubricCriterionScore]
    deductions: List[dict]
    rewrite_priority: List[str]
    structured_loss_run: dict = Field(default_factory=dict)
    predicted_score: float = 0.0
    max_score: float = 0.0
    forecast_percentage: float = 0.0
    explainable_feedback: List[str] = Field(default_factory=list)
    rewrite_priority_ranked: List[dict] = Field(default_factory=list)
    rubric_lineage_tracking: List[dict] = Field(default_factory=list)


class AtRiskRequest(StrictBaseModel):
    lookback_days: int = Field(default=56, ge=7, le=180)
    min_risk_routes: int = Field(default=3, ge=2, le=20)


class AtRiskStudent(StrictBaseModel):
    student_id: str
    risk_routes: int
    recent_agents: List[str]
    last_routed_at: str


class AtRiskResponse(StrictBaseModel):
    lookback_days: int
    students: List[AtRiskStudent]


class KnowledgeVersionRecord(StrictBaseModel):
    revision_id: int
    week_tag: str
    stage: str
    created_at: str
    summary: dict


class StudentAssessmentRecord(StrictBaseModel):
    student_id: str
    marks_obtained: float = Field(ge=0.0)
    max_marks: float = Field(gt=0.0)
    co_scores: dict[str, float] = Field(default_factory=dict)
    po_scores: dict[str, float] = Field(default_factory=dict)
    attendance_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    feedback: str = ""


class CoPoMappingAutomationRequest(StrictBaseModel):
    week_tag: str
    course_code: str
    records: List[StudentAssessmentRecord]


class CoPoMappingAutomationResponse(StrictBaseModel):
    week_tag: str
    course_code: str
    mapping_summary: dict[str, dict[str, float]] = Field(default_factory=dict)
    mappings_upserted: int


class AttainmentCalculationRequest(StrictBaseModel):
    week_tag: str
    course_code: str
    target_attainment_percentage: float = Field(default=60.0, ge=0.0, le=100.0)


class AttainmentCalculationResponse(StrictBaseModel):
    week_tag: str
    course_code: str
    attainment_percentage: float
    co_attainment: dict[str, float] = Field(default_factory=dict)
    po_attainment: dict[str, float] = Field(default_factory=dict)
    compliant: bool


class CieDocumentationRequest(StrictBaseModel):
    week_tag: str
    course_code: str
    faculty_name: str


class CieDocumentationResponse(StrictBaseModel):
    week_tag: str
    course_code: str
    cie_document: str


class AccreditationNarrativeRequest(StrictBaseModel):
    week_tag: str
    course_code: str
    framework: str = "NBA/NAAC"


class AccreditationNarrativeResponse(StrictBaseModel):
    week_tag: str
    course_code: str
    framework: str
    narrative: str


class RemedialRecommendation(StrictBaseModel):
    student_id: str
    risk_score: float
    recommendations: List[str] = Field(default_factory=list)


class BulkStudentReportRequest(StrictBaseModel):
    week_tag: str
    course_code: str
    student_ids: List[str] = Field(default_factory=list)


class BulkStudentReportResponse(StrictBaseModel):
    week_tag: str
    course_code: str
    generated_count: int
    reports: List[dict] = Field(default_factory=list)


class EvidenceCompilationRequest(StrictBaseModel):
    week_tag: str
    course_code: str


class EvidenceCompilationResponse(StrictBaseModel):
    week_tag: str
    course_code: str
    evidence_count: int
    lineage: List[dict] = Field(default_factory=list)


class FacultyDashboardResponse(StrictBaseModel):
    week_tag: str
    hours_saved_estimate: float
    pending_actions: List[str] = Field(default_factory=list)
    pending_action_count: int
    automation_metrics: dict = Field(default_factory=dict)


class ManualOverrideRequest(StrictBaseModel):
    week_tag: str
    course_code: str
    scope: str
    reference_id: str
    override_payload: dict = Field(default_factory=dict)
    reviewer: str


class ManualOverrideResponse(StrictBaseModel):
    override_id: int
    status: str


class LmsWebhookRegistrationRequest(StrictBaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "event_type": "faculty.bulk_reports.generated",
                "target_url": "https://lms.example.edu/hooks/events",
                "secret_token": "lms-shared-secret"
            }
        },
    )

    event_type: str = Field(min_length=3)
    target_url: str = Field(min_length=8)
    secret_token: str = ""


class LmsWebhookRegistrationResponse(StrictBaseModel):
    webhook_id: int
    event_type: str
    target_url: str
    active: bool


class LmsWebhookDispatchRequest(StrictBaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "event_type": "faculty.bulk_reports.generated",
                "payload": {"week_tag": "2026-W12", "course_code": "ECE401"}
            }
        },
    )

    event_type: str = Field(min_length=3)
    payload: dict = Field(default_factory=dict)


class BatchStudentOperationRequest(StrictBaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "week_tag": "2026-W12",
                "course_code": "ECE401",
                "operation": "risk_and_reports",
                "student_ids": ["S001", "S002"]
            }
        },
    )

    week_tag: str
    course_code: str
    operation: str = "risk_and_reports"
    student_ids: List[str] = Field(default_factory=list)


class BatchStudentOperationResponse(StrictBaseModel):
    week_tag: str
    course_code: str
    operation: str
    processed_count: int
    result: dict = Field(default_factory=dict)
