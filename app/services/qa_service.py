from app.audit import log_event
from app.config import settings
from app.llm import complete_text
from app.models import ChatRequest, ChatResponse, Citation
from app.personas import PERSONAS, route_persona
from app.storage import query_context


def _build_context_block(result: dict) -> tuple[str, list[Citation]]:
    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]

    citations: list[Citation] = []
    chunks: list[str] = []

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

    return "\n\n".join(chunks), citations


def answer_question(request: ChatRequest) -> ChatResponse:
    persona_id, routed_by = route_persona(request.question)
    persona = PERSONAS[persona_id]

    result = query_context(request.question, request.week_tag, settings.top_k)
    context_block, citations = _build_context_block(result)

    if not context_block:
        answer = "I do not have enough grounded material in the uploaded notes to answer this safely. Please upload this week's staff notes."
        response = ChatResponse(
            persona=persona["name"],
            answer=answer,
            citations=[],
            routed_by=routed_by,
        )
        log_event(
            "chat.no_context",
            {
                "question": request.question,
                "persona": persona["name"],
                "week_tag": request.week_tag,
            },
        )
        return response

    system_prompt = (
        f"{persona['system_prompt']} "
        "Hard rules: Never use outside knowledge. If the context is insufficient, say so. "
        "Every factual claim must be grounded in the provided context snippets. "
        "Use a Socratic first sentence when possible."
    )

    user_prompt = (
        f"Question: {request.question}\n\n"
        "Context snippets with lineage:\n"
        f"{context_block}\n\n"
        "Return a concise tutoring answer."
    )

    answer = complete_text(system_prompt, user_prompt)

    response = ChatResponse(
        persona=persona["name"],
        answer=answer,
        citations=citations,
        routed_by=routed_by,
    )

    log_event(
        "chat.completed",
        {
            "question": request.question,
            "persona": persona["name"],
            "week_tag": request.week_tag,
            "citation_count": len(citations),
        },
    )
    return response
