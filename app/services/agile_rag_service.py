import json
import re
from datetime import datetime

from app.audit import log_event
from app.config import settings
from app.knowledge_versioning import create_knowledge_revision, list_knowledge_revisions
from app.llm import complete_text, transcribe_audio
from app.models import (
    ExamQuestion,
    ExamResponse,
    MondayIngestRequest,
    MondayIngestResponse,
    RouterRequest,
    RouterResponse,
    TuesdayAlignmentRequest,
    TuesdayAlignmentResponse,
    WednesdayExecutionRequest,
)
from app.parser import ParsedParagraph
from app.personas import ACADEMIC_SUCCESS_AGENTS, route_success_agent
from app.storage import apply_keyword_emphasis, query_context, upsert_paragraphs


def _derive_week_tag(week_tag: str | None) -> str:
    return week_tag or datetime.utcnow().strftime("%Y-W%U")


def _split_transcript_to_paragraphs(transcript: str, source_file: str) -> list[ParsedParagraph]:
    parts = [p.strip() for p in re.split(r"\n\s*\n", transcript) if p.strip()]
    if not parts:
        parts = [transcript.strip()] if transcript.strip() else []

    paragraphs: list[ParsedParagraph] = []
    for idx, text in enumerate(parts, start=1):
        paragraphs.append(
            ParsedParagraph(
                paragraph_id=f"transcript-para-{idx}",
                source_file=source_file,
                page=1,
                text=text,
            )
        )
    return paragraphs


def monday_ingest_transcript(request: MondayIngestRequest) -> MondayIngestResponse:
    week_tag = _derive_week_tag(request.week_tag)
    date_stamp = request.date_stamp or datetime.utcnow().date().isoformat()
    source_file = f"{request.source_label}.txt"

    paragraphs = _split_transcript_to_paragraphs(request.transcript_text, source_file)

    pre_revision = create_knowledge_revision(
        week_tag=week_tag,
        stage="monday.ingestion.started",
        summary={"source_label": request.source_label, "paragraph_count": len(paragraphs), "date_stamp": date_stamp},
    )

    indexed = upsert_paragraphs(
        paragraphs,
        week_tag=week_tag,
        date_stamp=date_stamp,
        source_type="monday_transcript",
        knowledge_revision=pre_revision,
    )

    revision = create_knowledge_revision(
        week_tag=week_tag,
        stage="monday.ingestion.completed",
        summary={
            "source_label": request.source_label,
            "paragraphs_indexed": indexed,
            "date_stamp": date_stamp,
        },
    )

    log_event(
        "orchestrator.monday.completed",
        {
            "week_tag": week_tag,
            "source_label": request.source_label,
            "knowledge_revision": revision,
            "paragraphs_indexed": indexed,
        },
    )

    return MondayIngestResponse(
        week_tag=week_tag,
        source_label=request.source_label,
        knowledge_revision=revision,
        paragraphs_indexed=indexed,
        date_stamp=date_stamp,
    )


def monday_ingest_audio(file_name: str, file_bytes: bytes, week_tag: str | None = None) -> MondayIngestResponse:
    transcript = transcribe_audio(file_name=file_name, audio_bytes=file_bytes)
    request = MondayIngestRequest(
        transcript_text=transcript,
        week_tag=week_tag,
        source_label=file_name.rsplit(".", 1)[0],
    )
    return monday_ingest_transcript(request)


def _extract_syllabus_topics(syllabus_text: str, max_topics: int) -> list[str]:
    system_prompt = (
        "Extract high-weightage technical topics from a syllabus. "
        "Return strict JSON: {\"topics\": [str, ...]}."
    )
    user_prompt = f"Max topics: {max_topics}\n\nSyllabus:\n{syllabus_text}"

    raw = complete_text(system_prompt, user_prompt, temperature=0.0)
    try:
        parsed = json.loads(raw)
        topics = [str(t).strip() for t in parsed.get("topics", []) if str(t).strip()]
        if topics:
            return topics[:max_topics]
    except json.JSONDecodeError:
        pass

    fallback = []
    for token in re.split(r"[,;\n]", syllabus_text):
        t = token.strip()
        if len(t) >= 4:
            fallback.append(t)
        if len(fallback) >= max_topics:
            break
    return fallback


def _compute_topic_weights(topics: list[str], week_tag: str) -> dict[str, float]:
    keyword_weights: dict[str, float] = {}
    for topic in topics:
        result = query_context(question=topic, week_tag=week_tag, top_k=6)
        docs = result.get("documents", [[]])[0]
        coverage = len([d for d in docs if topic.lower() in d.lower()])

        if coverage >= 4:
            keyword_weights[topic] = 2.2
        elif coverage >= 2:
            keyword_weights[topic] = 1.6
        elif coverage == 1:
            keyword_weights[topic] = 1.2
        else:
            keyword_weights[topic] = 0.9

    return keyword_weights


def tuesday_align(request: TuesdayAlignmentRequest) -> TuesdayAlignmentResponse:
    topics = _extract_syllabus_topics(request.syllabus_text, request.max_topics)
    keyword_weights = _compute_topic_weights(topics, request.week_tag)

    revision = create_knowledge_revision(
        week_tag=request.week_tag,
        stage="tuesday.alignment",
        summary={"topics": topics, "keyword_weights": keyword_weights},
    )

    chunks_updated = apply_keyword_emphasis(
        week_tag=request.week_tag,
        keyword_weights=keyword_weights,
        knowledge_revision=revision,
    )

    log_event(
        "orchestrator.tuesday.completed",
        {
            "week_tag": request.week_tag,
            "knowledge_revision": revision,
            "topics_analyzed": topics,
            "chunks_updated": chunks_updated,
        },
    )

    return TuesdayAlignmentResponse(
        week_tag=request.week_tag,
        knowledge_revision=revision,
        topics_analyzed=topics,
        keyword_weights=keyword_weights,
        chunks_updated=chunks_updated,
    )


def wednesday_execute(request: WednesdayExecutionRequest) -> ExamResponse:
    query = "Generate weighted practice questions from Monday lecture and Tuesday alignment."
    result = query_context(query, request.week_tag, max(settings.top_k * 2, request.num_questions))

    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]
    context_lines = []
    lineage_pool = []

    for doc, meta in zip(documents, metadatas):
        lineage = f"{meta.get('source_file', 'unknown')}#p{meta.get('page', 0)}:{meta.get('paragraph_id', 'unknown')}"
        lineage_pool.append(lineage)
        context_lines.append(f"[{lineage}]\\n{doc}")

    if not context_lines:
        log_event("orchestrator.wednesday.failed.no_context", {"week_tag": request.week_tag})
        return ExamResponse(week_tag=request.week_tag, generated_at=datetime.utcnow(), questions=[])

    system_prompt = (
        "You are the Rubric Referee. Create exam-ready questions grounded only in provided context. "
        "Prioritize topics with higher emphasis and align with likely marking scheme expectations. "
        "Return strict JSON with key 'questions'."
    )

    user_prompt = (
        f"Week: {request.week_tag}\\n"
        f"Count: {request.num_questions}\\n\\n"
        "Context:\\n"
        f"{'\\n\\n'.join(context_lines)}\\n\\n"
        "JSON schema: {\"questions\": [{\"question\": str, \"answer_key\": str, \"difficulty\": str, \"bloom_level\": str, \"source_lineage\": [str]}]}"
    )

    raw = complete_text(system_prompt, user_prompt, temperature=0.2)

    try:
        parsed = json.loads(raw)
        qitems = parsed.get("questions", [])
    except json.JSONDecodeError:
        qitems = []

    questions: list[ExamQuestion] = []
    for item in qitems:
        lineage = item.get("source_lineage") or lineage_pool[:2]
        questions.append(
            ExamQuestion(
                question=item.get("question", ""),
                answer_key=item.get("answer_key", ""),
                difficulty=item.get("difficulty", "medium"),
                bloom_level=item.get("bloom_level", "understand"),
                source_lineage=lineage,
            )
        )

    revision = create_knowledge_revision(
        week_tag=request.week_tag,
        stage="wednesday.execution",
        summary={"requested": request.num_questions, "generated": len(questions)},
    )

    log_event(
        "orchestrator.wednesday.completed",
        {
            "week_tag": request.week_tag,
            "knowledge_revision": revision,
            "generated": len(questions),
        },
    )

    return ExamResponse(week_tag=request.week_tag, generated_at=datetime.utcnow(), questions=questions)


def _build_agent_specific_plan(agent_id: str, goal: str, week_tag: str | None) -> tuple[str, dict | None]:
    context = ""
    if week_tag:
        result = query_context(question=goal, week_tag=week_tag, top_k=4)
        documents = result.get("documents", [[]])[0]
        context = "\n\n".join(documents)

    if agent_id == "agent_b":
        system_prompt = (
            "Produce a strict JSON loss run for rubric alignment. "
            "Schema: {\"loss_run\": {\"rubric_criteria\": [str], \"gaps\": [str], \"fixes\": [str]}}"
        )
        user_prompt = f"Goal: {goal}\n\nContext:\n{context}"
        raw = complete_text(system_prompt, user_prompt, temperature=0.0)
        try:
            parsed = json.loads(raw)
            loss_run = parsed.get("loss_run", {})
        except json.JSONDecodeError:
            loss_run = {
                "rubric_criteria": ["Structure", "Technical Correctness", "Marking Keywords"],
                "gaps": ["Missing explicit rubric language"],
                "fixes": ["Use rubric checklist before submission"],
            }

        action_plan = (
            "Rubric-first workflow: map every answer segment to scoring criteria, "
            "then run the JSON loss run to close presentation and sequencing gaps."
        )
        return action_plan, loss_run

    strategy = ACADEMIC_SUCCESS_AGENTS[agent_id]["strategy"]
    system_prompt = "Generate a concise student action plan in plain text."
    user_prompt = f"Goal: {goal}\nStrategy: {strategy}\nContext:\n{context}"
    action_plan = complete_text(system_prompt, user_prompt, temperature=0.2)
    return action_plan, None


def route_student_profile(request: RouterRequest) -> RouterResponse:
    profile_dict = request.profile.model_dump()
    agent_id, routed_by = route_success_agent(profile_dict)
    agent = ACADEMIC_SUCCESS_AGENTS[agent_id]

    action_plan, loss_run = _build_agent_specific_plan(agent_id, request.goal, request.week_tag)

    rationale = (
        f"Routed to {agent['name']} because profile signals match {agent['focus']} intervention: "
        f"{agent['strategy']}"
    )

    log_event(
        "orchestrator.router.completed",
        {
            "agent_id": agent_id,
            "agent_name": agent["name"],
            "routed_by": routed_by,
        },
    )

    return RouterResponse(
        agent_id=agent_id,
        agent_name=agent["name"],
        rationale=rationale,
        routed_by=routed_by,
        action_plan=action_plan,
        structured_loss_run=loss_run,
    )


def get_knowledge_versions(week_tag: str | None = None, limit: int = 50) -> list[dict]:
    return list_knowledge_revisions(week_tag=week_tag, limit=limit)
