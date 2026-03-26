import json
from datetime import datetime
from collections import Counter
import re

from app.audit import log_event
from app.config import settings
from app.llm import complete_text
from app.models import ExamRequest, ExamResponse, ExamQuestion
from app.storage import query_context


def _parse_csv_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [token for token in str(raw).split("|") if token]


_BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]
_DIFFICULTIES = ["Easy", "Medium", "Hard"]


def _normalize_bloom(value: str | None) -> str:
    token = str(value or "").strip().lower()
    mapping = {level.lower(): level for level in _BLOOM_LEVELS}
    return mapping.get(token, "Understand")


def _normalize_difficulty(value: str | None) -> str:
    token = str(value or "").strip().lower()
    mapping = {level.lower(): level for level in _DIFFICULTIES}
    return mapping.get(token, "Medium")


def _topic_signature(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{4,}", text.lower()))


def _assign_marks(total: int, question_index: int) -> int:
    if total <= 5:
        base = [2, 4, 6, 8, 10]
        return base[min(question_index, len(base) - 1)]
    if total <= 10:
        base = [4, 6, 8, 10]
        return base[question_index % len(base)]
    base = [2, 4, 6, 8, 10]
    return base[question_index % len(base)]


def _expected_structure(question: str, bloom: str, difficulty: str) -> list[str]:
    if bloom in {"Analyze", "Evaluate", "Create"} or difficulty == "Hard":
        return [
            "Definition and framing",
            "Stepwise reasoning",
            "Worked example or evidence",
            "Critical insight or trade-off",
        ]
    if bloom in {"Apply", "Understand"}:
        return [
            "Concept statement",
            "Method or formula",
            "Application to the given case",
            "Final concise conclusion",
        ]
    return ["Definition", "Key points", "Short conclusion"]


def _default_rubric_for_question(bloom: str, difficulty: str, marks: int) -> list[str]:
    base = [
        "Technical correctness",
        "Use of domain terminology",
        "Clarity and structure",
    ]
    if bloom in {"Analyze", "Evaluate", "Create"}:
        base.append("Depth of analysis")
    if difficulty == "Hard" or marks >= 8:
        base.append("Evidence and justification")
    return base


def _parse_generated_questions(raw: str) -> list[dict]:
    try:
        parsed = json.loads(raw)
        items = parsed.get("questions", [])
        return items if isinstance(items, list) else []
    except json.JSONDecodeError:
        return []


def _quality_checks(questions: list[ExamQuestion]) -> dict:
    stems = [q.question.strip().lower() for q in questions]
    unique_stems = len(set(stems))
    diversity_ratio = round((unique_stems / max(len(stems), 1)) * 100.0, 2)

    topic_overlap_alerts = 0
    signatures = [_topic_signature(q.question) for q in questions]
    for idx, left in enumerate(signatures):
        for right in signatures[idx + 1 :]:
            if not left or not right:
                continue
            overlap = len(left & right) / max(len(left | right), 1)
            if overlap > 0.8:
                topic_overlap_alerts += 1

    missing_lineage = len([q for q in questions if not q.source_lineage])
    missing_rubric = len([q for q in questions if not q.rubric_criteria])
    missing_answer_key = len([q for q in questions if not q.answer_key.strip()])

    return {
        "passed": topic_overlap_alerts == 0 and missing_lineage == 0 and missing_rubric == 0 and missing_answer_key == 0,
        "diversity_ratio_percentage": diversity_ratio,
        "topic_overlap_alerts": topic_overlap_alerts,
        "missing_lineage": missing_lineage,
        "missing_rubric": missing_rubric,
        "missing_answer_key": missing_answer_key,
    }


def _build_distributions(questions: list[ExamQuestion]) -> tuple[dict[str, int], dict[str, int]]:
    marks_distribution: dict[str, int] = {
        "Easy": 0,
        "Medium": 0,
        "Hard": 0,
        "total_marks": 0,
    }
    bloom_distribution: dict[str, int] = {level: 0 for level in _BLOOM_LEVELS}

    for q in questions:
        marks_distribution[q.difficulty] = marks_distribution.get(q.difficulty, 0) + int(q.marks)
        marks_distribution["total_marks"] += int(q.marks)
        bloom_distribution[q.bloom_level] = bloom_distribution.get(q.bloom_level, 0) + 1

    return marks_distribution, bloom_distribution


def generate_exam(request: ExamRequest) -> ExamResponse:
    query = "Generate a complete revision map for this week with topic diversity and marks pattern."
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
        "Generate context-grounded questions only from supplied week data. "
        "Ensure diversity and topic coverage. "
        "For each question return: question, answer_key, difficulty(Easy|Medium|Hard), "
        "bloom_level(Remember|Understand|Apply|Analyze|Evaluate|Create), source_lineage(list). "
        "Keep output strict JSON with key questions."
    )

    user_prompt = (
        f"Week: {request.week_tag}\n"
        f"Count: {request.num_questions}\n\n"
        "Context:\n"
        f"{context_block}\n\n"
        "Ensure mix across Bloom levels and difficulties, avoid repetition, and keep alignment to week topics.\n"
        "JSON schema: {\"questions\": [{\"question\": str, \"answer_key\": str, \"difficulty\": str, \"bloom_level\": str, \"source_lineage\": [str]}]}"
    )

    raw = complete_text(system_prompt, user_prompt, temperature=0.2)

    qitems = _parse_generated_questions(raw)

    questions = []
    used_signatures: list[set[str]] = []
    for idx, item in enumerate(qitems):
        question_text = str(item.get("question", "")).strip()
        if not question_text:
            continue

        signature = _topic_signature(question_text)
        is_duplicate = False
        for existing in used_signatures:
            if existing and signature and (len(existing & signature) / max(len(existing | signature), 1)) > 0.85:
                is_duplicate = True
                break
        if is_duplicate:
            continue
        used_signatures.append(signature)

        lineage = item.get("source_lineage") or lineage_pool[:2]
        co_tags: list[str] = []
        po_tags: list[str] = []
        for meta in metadatas:
            para_id = str(meta.get("paragraph_id", ""))
            if any(para_id in line for line in lineage):
                co_tags.extend(_parse_csv_tags(str(meta.get("co_tags_csv", ""))))
                po_tags.extend(_parse_csv_tags(str(meta.get("po_tags_csv", ""))))

        bloom_level = _normalize_bloom(str(item.get("bloom_level", "Understand")))
        difficulty = _normalize_difficulty(str(item.get("difficulty", "Medium")))
        marks = _assign_marks(request.num_questions, idx)
        expected_structure = _expected_structure(question_text, bloom_level, difficulty)
        rubric_criteria = _default_rubric_for_question(bloom_level, difficulty, marks)

        questions.append(
            ExamQuestion(
                question=question_text,
                answer_key=str(item.get("answer_key", "")).strip(),
                difficulty=difficulty,
                bloom_level=bloom_level,
                marks=marks,
                expected_response_structure=expected_structure,
                rubric_criteria=rubric_criteria,
                source_lineage=lineage,
                co_tags=sorted(set(co_tags)),
                po_tags=sorted(set(po_tags)),
            )
        )

        if len(questions) >= request.num_questions:
            break

    if len(questions) < request.num_questions:
        for idx, meta in enumerate(metadatas[: request.num_questions - len(questions)]):
            fallback_question = f"Explain the significance of {meta.get('paragraph_id', 'the concept')} in the weekly syllabus context."
            lineage = [
                f"{meta.get('source_file', 'unknown.pdf')}#p{meta.get('page', 0)}:{meta.get('paragraph_id', 'unknown')}"
            ]
            marks = _assign_marks(request.num_questions, len(questions) + idx)
            bloom_level = "Understand"
            difficulty = "Medium"
            questions.append(
                ExamQuestion(
                    question=fallback_question,
                    answer_key="Define the concept, state core principle, and connect it to one practical scenario from the week.",
                    difficulty=difficulty,
                    bloom_level=bloom_level,
                    marks=marks,
                    expected_response_structure=_expected_structure(fallback_question, bloom_level, difficulty),
                    rubric_criteria=_default_rubric_for_question(bloom_level, difficulty, marks),
                    source_lineage=lineage,
                    co_tags=_parse_csv_tags(str(meta.get("co_tags_csv", ""))),
                    po_tags=_parse_csv_tags(str(meta.get("po_tags_csv", ""))),
                )
            )
            if len(questions) >= request.num_questions:
                break

    marks_distribution, bloom_distribution = _build_distributions(questions)
    quality = _quality_checks(questions)

    response = ExamResponse(
        week_tag=request.week_tag,
        generated_at=datetime.utcnow(),
        questions=questions,
        marks_distribution=marks_distribution,
        bloom_distribution=bloom_distribution,
        quality_checks=quality,
    )

    log_event(
        "exam.completed",
        {
            "week_tag": request.week_tag,
            "requested": request.num_questions,
            "generated": len(questions),
            "marks_distribution": marks_distribution,
            "bloom_distribution": bloom_distribution,
            "quality_checks": quality,
        },
    )

    return response
