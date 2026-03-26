import json
import re
from datetime import datetime
from collections import Counter
from typing import Any

from app.audit import log_event, recent_events
from app.alignment_engine import (
    analyze_past_papers,
    build_alignment_report,
    compare_taught_vs_syllabus,
    compute_emphasis_weights,
    extract_taught_topic_stats,
    parse_syllabus_text,
)
from app.agent_prompts import AGENT_PROMPTS
from app.config import settings
from app.knowledge_snapshot import store_knowledge_snapshot
from app.knowledge_versioning import create_knowledge_revision, list_knowledge_revisions
from app.llm import complete_text, transcribe_audio
from app.models import (
    ExamRequest,
    ExamQuestion,
    ExamResponse,
    MondayIngestRequest,
    MondayIngestResponse,
    RubricCriterionScore,
    RubricGpsRequest,
    RubricGpsResponse,
    RouterRequest,
    RouterResponse,
    AtRiskRequest,
    AtRiskResponse,
    AtRiskStudent,
    TuesdayAlignmentRequest,
    TuesdayAlignmentResponse,
    WednesdayExecutionRequest,
)
from app.parser import ParsedParagraph
from app.personas import ACADEMIC_SUCCESS_AGENTS
from app.services.exam_service import generate_exam
from app.rubric_engine import evaluate_rubric, fallback_criteria_from_text, load_rubric_criteria
from app.routing_policy import evaluate_routing_policy
from app.storage import apply_keyword_emphasis, query_context, trigger_immediate_reindex, upsert_paragraphs
from app.storage import get_week_chunks


def _derive_week_tag(week_tag: str | None) -> str:
    return week_tag or datetime.utcnow().strftime("%Y-W%U")


def _parse_csv_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [token for token in str(raw).split("|") if token]


def _extract_keywords(text: str, limit: int = 4) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z\-]{3,}", text.lower())
    stop = {
        "this",
        "that",
        "with",
        "from",
        "have",
        "were",
        "into",
        "will",
        "should",
        "their",
        "there",
        "about",
        "using",
        "answer",
        "question",
        "criteria",
        "marks",
        "marking",
    }
    uniq: list[str] = []
    for token in tokens:
        if token in stop or token in uniq:
            continue
        uniq.append(token)
        if len(uniq) >= limit:
            break
    return uniq


def _extract_rubric_criteria(rubric_text: str) -> list[str]:
    lines = [line.strip(" -\t") for line in rubric_text.splitlines() if line.strip()]
    criteria = [line for line in lines if len(line) >= 12][:8]
    if criteria:
        return criteria

    sentences = [s.strip() for s in re.split(r"[\.;]", rubric_text) if len(s.strip()) >= 12]
    return sentences[:8]


def _build_rubric_scores(criteria: list[str], draft_answer: str) -> tuple[list[RubricCriterionScore], list[RubricCriterionScore], list[dict], list[str]]:
    met: list[RubricCriterionScore] = []
    missed: list[RubricCriterionScore] = []
    deductions: list[dict] = []
    rewrite_priority: list[str] = []

    answer_lower = draft_answer.lower()
    for criterion in criteria:
        required_keywords = _extract_keywords(criterion)
        matched_keywords = [kw for kw in required_keywords if kw in answer_lower]
        ratio = (len(matched_keywords) / max(len(required_keywords), 1))
        confidence = round(ratio, 2)
        is_met = ratio >= 0.6
        explanation = (
            "Criterion evidence present in draft answer."
            if is_met
            else "Required criterion evidence is missing or weak in the draft answer."
        )

        item = RubricCriterionScore(
            criterion=criterion,
            met=is_met,
            confidence=confidence,
            explanation=explanation,
            required_keywords=required_keywords,
            matched_keywords=matched_keywords,
        )

        if is_met:
            met.append(item)
            continue

        missed.append(item)
        deductions.append(
            {
                "criterion": criterion,
                "reason": "Missing required rubric evidence",
                "likely_mark_loss": 2 if confidence < 0.3 else 1,
                "missing_keywords": [kw for kw in required_keywords if kw not in matched_keywords],
            }
        )
        rewrite_priority.append(
            f"Add explicit coverage for '{criterion}' and include keywords: {', '.join(required_keywords) or 'core terminology'}"
        )

    return met, missed, deductions, rewrite_priority[:6]


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
                paragraph_index=idx,
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
        uploaded_at=datetime.utcnow().isoformat(),
        source_type="monday_transcript",
        source_label=request.source_label,
        knowledge_revision=pre_revision,
    )

    reindex_status = trigger_immediate_reindex(
        week_tag=week_tag,
        reason="monday.transcript",
        source_label=request.source_label,
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
    log_event("reindex.triggered", reindex_status)
    store_knowledge_snapshot(
        week_tag=week_tag,
        revision_id=revision,
        stage="monday.ingestion.completed",
        source_label=request.source_label,
        extra={"paragraphs_indexed": indexed, "date_stamp": date_stamp},
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


def _tokenize_topics(text: str, max_topics: int) -> list[str]:
    phrases = [p.strip() for p in re.split(r"[,;\n]", text) if p.strip()]
    topics: list[str] = []
    for phrase in phrases:
        if 4 <= len(phrase) <= 100:
            topics.append(phrase)
        if len(topics) >= max_topics:
            break
    return topics


def _extract_taught_topics_from_chunks(week_tag: str, max_topics: int) -> list[str]:
    records = get_week_chunks(week_tag)
    docs = [str(d) for d in records.get("documents", [])]
    counter: Counter[str] = Counter()

    for doc in docs:
        fragments = re.split(r"[\n\.;:]", doc)
        for fragment in fragments:
            normalized = " ".join(fragment.strip().split())
            if len(normalized) < 8 or len(normalized) > 90:
                continue
            if len(normalized.split()) > 8:
                continue
            counter[normalized.lower()] += 1

    return [topic for topic, _ in counter.most_common(max_topics)]


def _compute_drift(
    taught_topics: list[str],
    syllabus_topics: list[str],
    past_paper_topics: list[str],
) -> tuple[list[str], list[str], float, list[str]]:
    def _signature(topic: str) -> set[str]:
        return set(re.findall(r"[a-z0-9]{3,}", topic.lower()))

    def _best_overlap(topic: str, candidates: list[str]) -> float:
        base = _signature(topic)
        if not base:
            return 0.0
        best = 0.0
        for candidate in candidates:
            other = _signature(candidate)
            if not other:
                continue
            inter = len(base & other)
            union = len(base | other)
            if union == 0:
                continue
            best = max(best, inter / union)
        return best

    taught_not_in_syllabus = [
        topic.lower()
        for topic in taught_topics
        if _best_overlap(topic, syllabus_topics) < 0.45
    ][:12]

    syllabus_not_covered = [
        topic.lower()
        for topic in syllabus_topics
        if _best_overlap(topic, taught_topics) < 0.45
    ][:12]

    past_priority = [
        topic.lower()
        for topic in past_paper_topics
        if _best_overlap(topic, syllabus_topics) >= 0.45 and _best_overlap(topic, taught_topics) < 0.45
    ][:12]

    denominator = max(len(syllabus_topics), 1)
    drift_score = round(min(1.0, len(syllabus_not_covered) / denominator), 3)
    return taught_not_in_syllabus, syllabus_not_covered, drift_score, past_priority


def tuesday_align(request: TuesdayAlignmentRequest) -> TuesdayAlignmentResponse:
    syllabus_payload = parse_syllabus_text(request.syllabus_text, request.max_topics)
    topics = syllabus_payload["topics"]
    learning_outcomes = syllabus_payload["learning_outcomes"]

    taught_topic_stats = extract_taught_topic_stats(request.week_tag, request.max_topics)
    past_paper_stats = analyze_past_papers(request.past_paper_text, request.max_topics)

    comparison = compare_taught_vs_syllabus(
        taught_topic_stats=taught_topic_stats,
        syllabus_topics=topics,
    )
    taught_not_in_syllabus = list(comparison["over_emphasized_topics"])
    syllabus_not_covered = list(comparison["missed_topics"])
    drift_score = float(comparison["drift_score_percentage"])

    keyword_weights, priority_boost_topics = compute_emphasis_weights(
        taught_topic_stats=taught_topic_stats,
        syllabus_topics=topics,
        past_paper_topics=past_paper_stats,
    )

    alignment_report = build_alignment_report(
        week_tag=request.week_tag,
        syllabus_topics=topics,
        learning_outcomes=learning_outcomes,
        taught_topic_stats=taught_topic_stats,
        past_paper_topics=past_paper_stats,
        comparison=comparison,
        keyword_weights=keyword_weights,
        priority_boost_topics=priority_boost_topics,
    )

    before_snapshot_id = store_knowledge_snapshot(
        week_tag=request.week_tag,
        revision_id=None,
        stage="tuesday.alignment.before",
        source_label="tuesday-alignment",
        extra={"alignment_report": alignment_report},
    )

    log_event(
        "orchestrator.tuesday.started",
        {
            "week_tag": request.week_tag,
            "topics_analyzed": topics,
            "learning_outcomes": learning_outcomes,
            "before_snapshot_id": before_snapshot_id,
            "drift_score_percentage": drift_score,
        },
    )

    revision = create_knowledge_revision(
        week_tag=request.week_tag,
        stage="tuesday.alignment",
        summary={
            "topics": topics,
            "past_paper_topics": [row["topic"] for row in past_paper_stats],
            "learning_outcomes": learning_outcomes,
            "keyword_weights": keyword_weights,
            "taught_not_in_syllabus": taught_not_in_syllabus,
            "syllabus_not_covered": syllabus_not_covered,
            "drift_score": drift_score,
            "priority_topic_boosts": priority_boost_topics,
        },
    )

    chunks_updated = apply_keyword_emphasis(
        week_tag=request.week_tag,
        keyword_weights=keyword_weights,
        knowledge_revision=revision,
    )

    after_snapshot_id = store_knowledge_snapshot(
        week_tag=request.week_tag,
        revision_id=revision,
        stage="tuesday.alignment.completed",
        source_label="tuesday-alignment",
        extra={
            "chunks_updated": chunks_updated,
            "drift_score": drift_score,
            "topics_analyzed": topics,
            "syllabus_not_covered": syllabus_not_covered,
            "alignment_report": alignment_report,
            "before_snapshot_id": before_snapshot_id,
        },
    )

    log_event(
        "orchestrator.tuesday.completed",
        {
            "week_tag": request.week_tag,
            "knowledge_revision": revision,
            "topics_analyzed": topics,
            "chunks_updated": chunks_updated,
            "taught_not_in_syllabus": taught_not_in_syllabus,
            "syllabus_not_covered": syllabus_not_covered,
            "drift_score": drift_score,
            "priority_topic_boosts": priority_boost_topics,
            "before_snapshot_id": before_snapshot_id,
            "after_snapshot_id": after_snapshot_id,
            "alignment_report": alignment_report,
        },
    )

    return TuesdayAlignmentResponse(
        week_tag=request.week_tag,
        knowledge_revision=revision,
        topics_analyzed=topics,
        keyword_weights=keyword_weights,
        chunks_updated=chunks_updated,
        learning_outcomes=learning_outcomes,
        alignment_report=alignment_report,
        priority_topic_boosts=priority_boost_topics,
        before_snapshot_id=before_snapshot_id,
        after_snapshot_id=after_snapshot_id,
        taught_not_in_syllabus=taught_not_in_syllabus,
        syllabus_not_covered=syllabus_not_covered,
        past_paper_priority_topics=[row["topic"] for row in past_paper_stats],
        drift_score=drift_score,
    )


def wednesday_execute(request: WednesdayExecutionRequest) -> ExamResponse:
    exam = generate_exam(ExamRequest(week_tag=request.week_tag, num_questions=request.num_questions))

    if not exam.questions:
        log_event("orchestrator.wednesday.failed.no_context", {"week_tag": request.week_tag})
        return exam

    revision = create_knowledge_revision(
        week_tag=request.week_tag,
        stage="wednesday.execution",
        summary={
            "requested": request.num_questions,
            "generated": len(exam.questions),
            "marks_distribution": exam.marks_distribution,
            "bloom_distribution": exam.bloom_distribution,
            "quality_checks": exam.quality_checks,
        },
    )

    log_event(
        "orchestrator.wednesday.completed",
        {
            "week_tag": request.week_tag,
            "knowledge_revision": revision,
            "generated": len(exam.questions),
            "marks_distribution": exam.marks_distribution,
            "bloom_distribution": exam.bloom_distribution,
            "quality_checks": exam.quality_checks,
            "used_chunk_lineage": [q.source_lineage[0] for q in exam.questions if q.source_lineage][:12],
        },
    )

    return exam


def _llm_route_assist(profile: dict[str, Any]) -> tuple[str, str]:
    system_prompt = (
        "Classify student profile into one of: agent_a, agent_b, agent_c, agent_d, agent_e, agent_f. "
        "Return strict JSON: {\"agent_id\": str, \"reason\": str}."
    )
    user_prompt = json.dumps(profile, ensure_ascii=True)
    raw = complete_text(system_prompt, user_prompt, temperature=0.0)
    try:
        parsed = json.loads(raw)
        agent_id = str(parsed.get("agent_id", "agent_e")).strip().lower()
        reason = str(parsed.get("reason", "llm disambiguation")).strip()
        if agent_id in ACADEMIC_SUCCESS_AGENTS:
            return agent_id, reason
    except json.JSONDecodeError:
        pass
    return "agent_e", "llm fallback defaulted to calibration"


def _build_agent_specific_plan(agent_id: str, goal: str, week_tag: str | None) -> tuple[str, dict | None]:
    context = ""
    prompt_meta = AGENT_PROMPTS.get(agent_id, {})
    persona_system = str(prompt_meta.get("system_prompt", ""))
    if week_tag:
        result = query_context(question=goal, week_tag=week_tag, top_k=4)
        documents = result.get("documents", [[]])[0]
        context = "\n\n".join(documents)

    if agent_id == "agent_b":
        system_prompt = persona_system or (
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

    if agent_id == "agent_a":
        system_prompt = persona_system or (
            "Produce strict JSON for a top performer score-optimization coaching plan. "
            "Schema: {\"sub_components\": [str], \"edge_case_checks\": [str], \"perfect_answer_gap\": [str]}"
        )
        user_prompt = f"Goal: {goal}\n\nContext:\n{context}"
        raw = complete_text(system_prompt, user_prompt, temperature=0.1)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {
                "sub_components": ["Define core concept", "Apply to advanced scenario", "State constraints"],
                "edge_case_checks": ["Boundary condition", "Counter-example"],
                "perfect_answer_gap": ["Missing evaluator-facing phrasing"],
            }
        action_plan = "Decompose every answer, verify edge cases, and close the gap between good and 10/10 evaluator expectations."
        return action_plan, payload

    if agent_id == "agent_c":
        system_prompt = persona_system or (
            "Produce strict JSON transfer tasks using variation theory. "
            "Schema: {\"constant_concept\": str, \"context_shifts\": [str], \"transfer_tasks\": [str]}"
        )
        user_prompt = f"Goal: {goal}\n\nContext:\n{context}"
        raw = complete_text(system_prompt, user_prompt, temperature=0.2)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {
                "constant_concept": "Keep formula unchanged",
                "context_shifts": ["Industrial setting", "Medical setting"],
                "transfer_tasks": ["Apply same formula in an unseen scenario"],
            }
        action_plan = "Hold concept constant, rotate contexts, and force formula-to-reality transfer on each practice item."
        return action_plan, payload

    if agent_id == "agent_d":
        system_prompt = persona_system or (
            "Produce strict JSON for a socratic foundation rebuild plan. "
            "Schema: {\"foundation_layers\": [str], \"why_questions\": [str], \"advance_rule\": str}"
        )
        user_prompt = f"Goal: {goal}\n\nContext:\n{context}"
        raw = complete_text(system_prompt, user_prompt, temperature=0.1)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {
                "foundation_layers": ["Terminology", "Physical intuition", "Simple relation"],
                "why_questions": ["Why does this relation hold?", "Why does this assumption matter?"],
                "advance_rule": "Move forward only after each layer is explained in own words",
            }
        action_plan = "Start two levels below the apparent gap, run why-first checkpoints, and only then move to exam-level questions."
        return action_plan, payload

    if agent_id == "agent_e":
        week_chunks = get_week_chunks(week_tag) if week_tag else {"documents": []}
        taught_points = [str(d)[:90] for d in week_chunks.get("documents", [])[:6]]
        payload = {
            "calibration_findings": [
                "Compare revision sequence against current teaching week",
                "Detect mismatch between revised topics and tested topics",
            ],
            "current_week_taught_signals": taught_points,
            "recommended_reset": "Prioritize current week objectives before legacy revision loops",
        }
        action_plan = "Calibrate execution: align revision order to current teaching emphasis and remove week-to-week drift."
        return action_plan, payload

    if agent_id == "agent_f":
        if week_tag:
            triage_result = query_context(question="highest emphasis exam topics", week_tag=week_tag, top_k=6)
            triage_meta = triage_result.get("metadatas", [[]])[0]
        else:
            triage_meta = []
        priority = [
            {
                "topic_hint": str(meta.get("paragraph_id", "topic")),
                "source": str(meta.get("source_file", "unknown")),
                "emphasis_weight": float(meta.get("emphasis_weight", 1.0)),
            }
            for meta in triage_meta[:4]
        ]
        payload = {
            "strategy": "80/20 triage",
            "priority_topics": priority,
            "skip_policy": "Skip low-emphasis long-tail topics until top priorities are complete",
        }
        action_plan = "Execute a strict 48-hour triage plan: cover only highest-weight topics first to maximize reachable marks."
        return action_plan, payload

    strategy = ACADEMIC_SUCCESS_AGENTS[agent_id]["strategy"]
    system_prompt = "Generate a concise student action plan in plain text."
    user_prompt = f"Goal: {goal}\nStrategy: {strategy}\nContext:\n{context}"
    action_plan = complete_text(system_prompt, user_prompt, temperature=0.2)
    return action_plan, None


def route_student_profile(request: RouterRequest) -> RouterResponse:
    profile_dict = request.profile.model_dump()
    decision = evaluate_routing_policy(profile_dict)
    agent_id, routed_by = decision.agent_id, decision.routed_by

    if routed_by == "policy-scorecard" and max(decision.scorecard.values()) <= 1.0:
        llm_agent, llm_reason = _llm_route_assist(profile_dict)
        agent_id = llm_agent
        routed_by = f"llm-assisted:{llm_reason}"

    agent = ACADEMIC_SUCCESS_AGENTS[agent_id]

    action_plan, specialist_payload = _build_agent_specific_plan(agent_id, request.goal, request.week_tag)

    marks = request.profile.marks
    avg_marks = (sum(marks) / len(marks)) if marks else 0.0

    rationale = (
        f"Routed to {agent['name']} because profile signals match {agent['focus']} intervention: "
        f"{agent['strategy']}"
    )

    routing_evidence = {
        "avg_marks": round(avg_marks, 2),
        "feedback": request.profile.feedback,
        "study_habits": request.profile.study_habits,
        "attendance_ratio": request.profile.attendance_ratio,
        "days_until_exam": request.profile.days_until_exam,
        "preparation_window_days": request.profile.preparation_window_days,
        "urgency_override": decision.urgency_override,
        "policy_scorecard": decision.scorecard,
        "decision_trace": decision.decision_trace,
        "prompt_persona": AGENT_PROMPTS.get(agent_id, {}).get("persona", ""),
        "rule_path": routed_by,
    }

    log_event(
        "orchestrator.router.completed",
        {
            "student_id": request.profile.student_id,
            "week_tag": request.week_tag,
            "agent_id": agent_id,
            "agent_name": agent["name"],
            "routed_by": routed_by,
            "routing_evidence": routing_evidence,
        },
    )

    return RouterResponse(
        agent_id=agent_id,
        agent_name=agent["name"],
        rationale=rationale,
        routed_by=routed_by,
        action_plan=action_plan,
        routing_evidence=routing_evidence,
        structured_loss_run=specialist_payload if agent_id == "agent_b" else None,
        specialist_payload=specialist_payload,
    )


def run_rubric_gps(request: RubricGpsRequest) -> RubricGpsResponse:
    rubric_query = f"rubric marking scheme {request.unit_tag or ''} {request.question}".strip()
    result = query_context(question=rubric_query, week_tag=request.week_tag, top_k=8)
    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]

    rubric_snippets: list[str] = []
    rubric_lineage: list[str] = []
    for doc, meta in zip(documents, metadatas):
        source_file = str(meta.get("source_file", ""))
        source_type = str(meta.get("source_type", ""))
        is_rubric_like = "rubric" in source_file.lower() or source_type in {"rubric", "syllabus", "raw_text"}
        if not is_rubric_like:
            continue

        rubric_snippets.append(str(doc))
        rubric_lineage.append(f"{source_file}#p{meta.get('page', 0)}:{meta.get('paragraph_id', 'unknown')}")
        if len(rubric_snippets) >= 4:
            break

    if not rubric_snippets:
        rubric_snippets = [str(d) for d in documents[:3]]
        rubric_lineage = [
            f"{m.get('source_file', 'unknown')}#p{m.get('page', 0)}:{m.get('paragraph_id', 'unknown')}"
            for m in metadatas[:3]
        ]

    rubric_text = "\n".join(rubric_snippets)
    fallback_lines = _extract_rubric_criteria(rubric_text)
    rubric_key = request.unit_tag or f"week-{request.week_tag}"
    db_criteria = load_rubric_criteria(week_tag=request.week_tag, rubric_key=rubric_key)
    criteria = db_criteria or fallback_criteria_from_text(fallback_lines)

    evaluation = evaluate_rubric(
        student_id=request.student_id,
        week_tag=request.week_tag,
        rubric_key=rubric_key,
        question=request.question,
        draft_answer=request.draft_answer,
        criteria=criteria,
        rubric_source_lineage=rubric_lineage,
    )

    met = [RubricCriterionScore(**row) for row in evaluation["met_criteria"]]
    missed = [RubricCriterionScore(**row) for row in evaluation["missed_criteria"]]
    deductions = evaluation["deductions"]
    rewrite_priority_ranked = evaluation["rewrite_priority_ranked"]
    rewrite_priority = [str(row.get("recommendation", "")) for row in rewrite_priority_ranked[:6] if str(row.get("recommendation", "")).strip()]

    response = RubricGpsResponse(
        student_id=request.student_id,
        week_tag=request.week_tag,
        question=request.question,
        rubric_source_lineage=rubric_lineage,
        met_criteria=met,
        missed_criteria=missed,
        deductions=deductions,
        rewrite_priority=rewrite_priority,
        structured_loss_run=evaluation["structured_loss_run"],
        predicted_score=float(evaluation["predicted_score"]),
        max_score=float(evaluation["max_score"]),
        forecast_percentage=float(evaluation["forecast_percentage"]),
        explainable_feedback=list(evaluation["explainable_feedback"]),
        rewrite_priority_ranked=list(rewrite_priority_ranked),
        rubric_lineage_tracking=list(evaluation["rubric_lineage_tracking"]),
    )

    log_event(
        "rubric.gps.completed",
        {
            "student_id": request.student_id,
            "week_tag": request.week_tag,
            "question": request.question,
            "rubric_source_lineage": rubric_lineage,
            "met_count": len(met),
            "missed_count": len(missed),
            "deductions": deductions,
            "predicted_score": evaluation["predicted_score"],
            "max_score": evaluation["max_score"],
            "forecast_percentage": evaluation["forecast_percentage"],
            "rubric_key": rubric_key,
            "institutional_rules_applied": [
                row.get("institution_rule_id")
                for row in evaluation["rubric_lineage_tracking"]
                if row.get("institution_rule_id")
            ],
        },
    )

    return response


def predict_at_risk_students(request: AtRiskRequest) -> AtRiskResponse:
    events = recent_events(limit=5000)
    cutoff = datetime.utcnow().timestamp() - (request.lookback_days * 24 * 60 * 60)
    by_student: dict[str, list[dict[str, Any]]] = {}

    for event in events:
        if str(event.get("event_type")) != "orchestrator.router.completed":
            continue

        created_at = str(event.get("created_at", ""))
        try:
            ts = datetime.fromisoformat(created_at).timestamp()
        except ValueError:
            continue

        if ts < cutoff:
            continue

        payload = event.get("payload", {}) or {}
        student_id = str(payload.get("student_id", "")).strip()
        if not student_id:
            continue

        by_student.setdefault(student_id, []).append(
            {
                "agent_id": str(payload.get("agent_id", "")),
                "created_at": created_at,
            }
        )

    risky: list[AtRiskStudent] = []
    for student_id, entries in by_student.items():
        recent_agents = [e["agent_id"] for e in sorted(entries, key=lambda item: item["created_at"], reverse=True)]
        risk_routes = len([a for a in recent_agents if a in {"agent_d", "agent_f"}])
        if risk_routes < request.min_risk_routes:
            continue

        risky.append(
            AtRiskStudent(
                student_id=student_id,
                risk_routes=risk_routes,
                recent_agents=recent_agents[:8],
                last_routed_at=max(e["created_at"] for e in entries),
            )
        )

    risky.sort(key=lambda item: item.risk_routes, reverse=True)
    return AtRiskResponse(lookback_days=request.lookback_days, students=risky)


def get_knowledge_versions(week_tag: str | None = None, limit: int = 50) -> list[dict]:
    return list_knowledge_revisions(week_tag=week_tag, limit=limit)
