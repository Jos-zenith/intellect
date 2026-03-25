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


class ExamResponse(BaseModel):
    week_tag: str
    generated_at: datetime
    questions: List[ExamQuestion]


class IngestResponse(BaseModel):
    file_name: str
    week_tag: str
    pages_parsed: int
    paragraphs_indexed: int


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
    max_topics: int = Field(default=12, ge=3, le=30)


class TuesdayAlignmentResponse(BaseModel):
    week_tag: str
    knowledge_revision: int
    topics_analyzed: List[str]
    keyword_weights: dict[str, float]
    chunks_updated: int


class WednesdayExecutionRequest(BaseModel):
    week_tag: str
    num_questions: int = Field(default=10, ge=3, le=25)


class StudentPerformanceProfile(BaseModel):
    marks: List[float] = Field(default_factory=list)
    feedback: str = ""
    study_habits: str = ""
    attendance_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    preparation_window_days: int | None = Field(default=None, ge=0, le=60)


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
    structured_loss_run: dict | None = None


class KnowledgeVersionRecord(BaseModel):
    revision_id: int
    week_tag: str
    stage: str
    created_at: str
    summary: dict
