import json
import re

from app.audit import log_event
from app.config import settings
from app.llm import complete_text
from app.models import ChatRequest, ChatResponse, Citation
from app.personas import PERSONAS, route_persona
from app.storage import query_context
from app.tutoring_session import (
    choose_socratic_mode,
    detect_confusion,
    ensure_session,
    update_session_after_turn,
)


def _build_context_block(result: dict) -> tuple[str, list[Citation], list[str]]:
    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]

    citations: list[Citation] = []
    chunks: list[str] = []
    topic_hints: list[str] = []

    for idx, (doc, meta) in enumerate(zip(documents, metadatas), start=1):
        paragraph_id = str(meta.get("paragraph_id", f"unknown-{idx}"))
        source_file = str(meta.get("source_file", "unknown.pdf"))
        page = int(meta.get("page", 0))
        lineage_link = f"{source_file}#p{page}:{paragraph_id}"
        citations.append(
            Citation(
                paragraph_id=paragraph_id,
                source_file=source_file,
                page=page,
                lineage_link=lineage_link,
            )
        )
        chunks.append(f"[{lineage_link}]\\n{doc}")
        topic_hints.extend(re.findall(r"[A-Za-z][A-Za-z\-]{4,}", str(doc))[:5])

    return "\n\n".join(chunks), citations, topic_hints[:12]


def _best_similarity(question: str, result: dict) -> float:
    scores = result.get("scores", [[]])
    if not scores or not isinstance(scores, list) or not scores[0]:
        return 0.0
    numeric = [float(s) for s in scores[0] if isinstance(s, (int, float))]
    return max(numeric) if numeric else 0.0


def _generate_tutoring_payload(
    *,
    persona_prompt: str,
    socratic_mode: str,
    difficulty_level: str,
    question: str,
    context_block: str,
    citations: list[Citation],
    confusion_detected: bool,
) -> dict:
    citation_examples = [c.lineage_link for c in citations[:4]]
    system_prompt = (
        f"{persona_prompt} "
        "You are a Socratic tutor. Ground every factual claim in the provided context. "
        "Use citation markers in answer format [cite:<lineage_link>] for every key claim. "
        "Return strict JSON with keys: answer, guided_correction_pathway, analogy, transfer_scenario, conceptual_bridge."
    )
    user_prompt = (
        f"Socratic mode: {socratic_mode}\n"
        f"Difficulty level: {difficulty_level}\n"
        f"Confusion detected: {confusion_detected}\n"
        f"Question: {question}\n"
        f"Allowed citation lineage examples: {citation_examples}\n\n"
        "Context:\n"
        f"{context_block}\n\n"
        "guided_correction_pathway must be 3-6 short steps. "
        "analogy must map concept to engineering-friendly analogy. "
        "transfer_scenario must be a what-if application case."
    )

    raw = complete_text(system_prompt, user_prompt)
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    return {
        "answer": raw.strip(),
        "guided_correction_pathway": [],
        "analogy": "",
        "transfer_scenario": "",
        "conceptual_bridge": "",
    }


def _enforce_citations(answer: str, citations: list[Citation]) -> str:
    if re.search(r"\[cite:[^\]]+\]", answer):
        return answer
    if not citations:
        return answer
    enforced = answer.strip()
    appendix = " ".join([f"[cite:{c.lineage_link}]" for c in citations[:2]])
    return f"{enforced}\n\nEvidence: {appendix}".strip()


def answer_question(request: ChatRequest) -> ChatResponse:
    persona_id, routed_by = route_persona(request.question)
    persona = PERSONAS[persona_id]

    session = ensure_session(request.session_id, request.student_id, request.week_tag)
    socratic_mode = choose_socratic_mode(request.question, session)
    confusion_detected, confusion_signals, confusion_score = detect_confusion(request.question)

    result = query_context(request.question, request.week_tag, settings.top_k)
    context_block, citations, topic_hints = _build_context_block(result)
    best_similarity = _best_similarity(request.question, result)

    no_context = (not context_block) or (len(citations) == 0) or (best_similarity < 0.20)

    if no_context:
        answer = "I do not have enough grounded material in the uploaded notes to answer this safely. Please upload this week's staff notes."
        updated_session = update_session_after_turn(
            session_id=str(session["session_id"]),
            question=request.question,
            answer=answer,
            citations=[],
            metadata={
                "routed_by": routed_by,
                "persona": persona["name"],
                "blocked": True,
                "confusion_score": confusion_score,
            },
            confusion_detected=True,
            socratic_mode=socratic_mode,
        )
        response = ChatResponse(
            persona=persona["name"],
            answer=answer,
            citations=[],
            routed_by=routed_by,
            session_id=str(session["session_id"]),
            socratic_mode=socratic_mode,
            confusion_detected=True,
            confusion_signals=confusion_signals or ["insufficient_grounded_context"],
            conceptual_bridge="",
            difficulty_level=str(updated_session.get("difficulty_level", "foundation")),
            guided_correction_pathway=[
                "Upload or ingest this week's topic notes.",
                "Ask one focused concept question with week tag.",
                "Retry with a specific example from lecture.",
            ],
            analogy="",
            transfer_scenario="",
            continuity_state={
                "turn_count": int(updated_session.get("turn_count", 0) or 0),
                "confusion_streak": int(updated_session.get("confusion_streak", 0) or 0),
            },
        )
        log_event(
            "chat.no_context",
            {
                "question": request.question,
                "persona": persona["name"],
                "week_tag": request.week_tag,
                "session_id": str(session["session_id"]),
                "socratic_mode": socratic_mode,
            },
        )
        return response

    tutoring_payload = _generate_tutoring_payload(
        persona_prompt=persona["system_prompt"],
        socratic_mode=socratic_mode,
        difficulty_level=str(session.get("difficulty_level", "foundation")),
        question=request.question,
        context_block=context_block,
        citations=citations,
        confusion_detected=confusion_detected,
    )

    answer = _enforce_citations(str(tutoring_payload.get("answer", "")).strip(), citations)
    guided = tutoring_payload.get("guided_correction_pathway", [])
    guided_steps = [str(step).strip() for step in guided if str(step).strip()] if isinstance(guided, list) else []
    analogy = str(tutoring_payload.get("analogy", "")).strip()
    transfer = str(tutoring_payload.get("transfer_scenario", "")).strip()
    conceptual_bridge = str(tutoring_payload.get("conceptual_bridge", "")).strip()

    if not conceptual_bridge and len(topic_hints) >= 2:
        conceptual_bridge = f"Bridge '{topic_hints[0]}' to '{topic_hints[1]}' by mapping the shared principle and then applying it to a new case."

    if not guided_steps:
        guided_steps = [
            "State the core concept in one sentence.",
            "Explain why it works with one grounded citation.",
            "Apply it to a small what-if variation.",
        ]

    updated_session = update_session_after_turn(
        session_id=str(session["session_id"]),
        question=request.question,
        answer=answer,
        citations=[c.model_dump() for c in citations],
        metadata={
            "routed_by": routed_by,
            "persona": persona["name"],
            "conceptual_bridge": conceptual_bridge,
            "confusion_score": confusion_score,
            "best_similarity": best_similarity,
            "socratic_mode": socratic_mode,
        },
        confusion_detected=confusion_detected,
        socratic_mode=socratic_mode,
    )

    response = ChatResponse(
        persona=persona["name"],
        answer=answer,
        citations=citations,
        routed_by=routed_by,
        session_id=str(session["session_id"]),
        socratic_mode=socratic_mode,
        confusion_detected=confusion_detected,
        confusion_signals=confusion_signals,
        conceptual_bridge=conceptual_bridge,
        difficulty_level=str(updated_session.get("difficulty_level", "foundation")),
        guided_correction_pathway=guided_steps,
        analogy=analogy,
        transfer_scenario=transfer,
        continuity_state={
            "turn_count": int(updated_session.get("turn_count", 0) or 0),
            "confusion_streak": int(updated_session.get("confusion_streak", 0) or 0),
            "last_socratic_mode": str(updated_session.get("last_socratic_mode", socratic_mode)),
        },
    )

    log_event(
        "chat.completed",
        {
            "question": request.question,
            "persona": persona["name"],
            "week_tag": request.week_tag,
            "citation_count": len(citations),
            "session_id": str(session["session_id"]),
            "socratic_mode": socratic_mode,
            "difficulty_level": response.difficulty_level,
            "confusion_detected": confusion_detected,
            "conceptual_bridge": conceptual_bridge,
        },
    )
    return response
