from datetime import datetime
from pydantic import BaseModel, Field
from typing import List


class Citation(BaseModel):
    paragraph_id: str
    source_file: str
    page: int
    lineage_link: str


class ChatRequest(BaseModel):
    question: str = Field(min_length=3)
    week_tag: str | None = None


class ChatResponse(BaseModel):
    persona: str
    answer: str
    citations: List[Citation]
    routed_by: str


class ExamRequest(BaseModel):
    week_tag: str
    num_questions: int = Field(default=10, ge=3, le=25)


class ExamQuestion(BaseModel):
    question: str
    answer_key: str
    difficulty: str
    bloom_level: str
    source_lineage: List[str]
    co_tags: List[str] = Field(default_factory=list)
    po_tags: List[str] = Field(default_factory=list)


class ExamResponse(BaseModel):
    week_tag: str
    generated_at: datetime
    questions: List[ExamQuestion]


class IngestResponse(BaseModel):
    file_name: str
    week_tag: str
    pages_parsed: int
    paragraphs_indexed: int
    source_type: str = "lecture_pdf"
    knowledge_revision: int | None = None
    date_stamp: str | None = None


class IngestTextRequest(BaseModel):
    source_label: str = "lecture-transcript"
    text: str = Field(min_length=30)
    week_tag: str | None = None
    date_stamp: str | None = None
    source_type: str = "raw_text"


class IngestTextResponse(BaseModel):
    source_label: str
    week_tag: str
    date_stamp: str
    paragraphs_indexed: int
    knowledge_revision: int


class MondayIngestRequest(BaseModel):
    transcript_text: str = Field(min_length=30)
    week_tag: str | None = None
    source_label: str = "monday-lecture"
    date_stamp: str | None = None


class MondayIngestResponse(BaseModel):
    week_tag: str
    source_label: str
    knowledge_revision: int
    paragraphs_indexed: int
    date_stamp: str


class TuesdayAlignmentRequest(BaseModel):
    week_tag: str
    syllabus_text: str = Field(min_length=30)
    past_paper_text: str = ""
    max_topics: int = Field(default=12, ge=3, le=30)


class TuesdayAlignmentResponse(BaseModel):
    week_tag: str
    knowledge_revision: int
    topics_analyzed: List[str]
    keyword_weights: dict[str, float]
    chunks_updated: int
    taught_not_in_syllabus: List[str] = Field(default_factory=list)
    syllabus_not_covered: List[str] = Field(default_factory=list)
    past_paper_priority_topics: List[str] = Field(default_factory=list)
    drift_score: float = 0.0


class WednesdayExecutionRequest(BaseModel):
    week_tag: str
    num_questions: int = Field(default=10, ge=3, le=25)


class StudentPerformanceProfile(BaseModel):
    student_id: str = ""
    marks: List[float] = Field(default_factory=list)
    feedback: str = ""
    study_habits: str = ""
    attendance_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    preparation_window_days: int | None = Field(default=None, ge=0, le=60)
    days_until_exam: int | None = Field(default=None, ge=0, le=60)


class RouterRequest(BaseModel):
    week_tag: str | None = None
    profile: StudentPerformanceProfile
    goal: str = "Improve Wednesday exam outcomes"


class RouterResponse(BaseModel):
    agent_id: str
    agent_name: str
    rationale: str
    routed_by: str
    action_plan: str
    routing_evidence: dict
    structured_loss_run: dict | None = None
    specialist_payload: dict | None = None


class RubricGpsRequest(BaseModel):
    student_id: str = Field(min_length=2)
    week_tag: str
    question: str = Field(min_length=5)
    draft_answer: str = Field(min_length=20)
    unit_tag: str | None = None


class RubricCriterionScore(BaseModel):
    criterion: str
    met: bool
    confidence: float
    explanation: str
    required_keywords: List[str]
    matched_keywords: List[str]


class RubricGpsResponse(BaseModel):
    student_id: str
    week_tag: str
    question: str
    rubric_source_lineage: List[str]
    met_criteria: List[RubricCriterionScore]
    missed_criteria: List[RubricCriterionScore]
    deductions: List[dict]
    rewrite_priority: List[str]


class AtRiskRequest(BaseModel):
    lookback_days: int = Field(default=56, ge=7, le=180)
    min_risk_routes: int = Field(default=3, ge=2, le=20)


class AtRiskStudent(BaseModel):
    student_id: str
    risk_routes: int
    recent_agents: List[str]
    last_routed_at: str


class AtRiskResponse(BaseModel):
    lookback_days: int
    students: List[AtRiskStudent]


class KnowledgeVersionRecord(BaseModel):
    revision_id: int
    week_tag: str
    stage: str
    created_at: str
    summary: dict
