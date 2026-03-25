import json
from datetime import datetime

from app.audit import log_event
from app.config import settings
from app.llm import complete_text
from app.models import ExamRequest, ExamResponse, ExamQuestion
from app.storage import query_context


def generate_exam(request: ExamRequest) -> ExamResponse:
    query = "Generate a complete revision map for this week."
    result = query_context(query, request.week_tag, max(settings.top_k * 2, request.num_questions))

    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]
    context_lines = []
    lineage_pool = []

    for doc, meta in zip(documents, metadatas):
        lineage = f"{meta.get('source_file', 'unknown.pdf')}#p{meta.get('page', 0)}:{meta.get('paragraph_id', 'unknown')}"
        lineage_pool.append(lineage)
        context_lines.append(f"[{lineage}]\\n{doc}")

    context_block = "\n\n".join(context_lines)

    if not context_block:
        log_event("exam.failed.no_context", {"week_tag": request.week_tag})
        return ExamResponse(week_tag=request.week_tag, generated_at=datetime.utcnow(), questions=[])

    system_prompt = (
        "You are AQPGS (Automated Question Paper Generation System). "
        "Generate exam questions grounded ONLY in supplied context. "
        "Return strict JSON with key 'questions'."
    )

    user_prompt = (
        f"Week: {request.week_tag}\n"
        f"Count: {request.num_questions}\n\n"
        "Context:\n"
        f"{context_block}\n\n"
        "JSON schema: {\"questions\": [{\"question\": str, \"answer_key\": str, \"difficulty\": str, \"bloom_level\": str, \"source_lineage\": [str]}]}"
    )

    raw = complete_text(system_prompt, user_prompt, temperature=0.2)

    try:
        parsed = json.loads(raw)
        qitems = parsed.get("questions", [])
    except json.JSONDecodeError:
        qitems = []

    questions = []
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

    response = ExamResponse(
        week_tag=request.week_tag,
        generated_at=datetime.utcnow(),
        questions=questions,
    )

    log_event(
        "exam.completed",
        {
            "week_tag": request.week_tag,
            "requested": request.num_questions,
            "generated": len(questions),
        },
    )

    return response
