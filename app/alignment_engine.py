from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from typing import Any

from app.llm import complete_text
from app.storage import get_week_chunks


def _norm_tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{3,}", text.lower()))


def _best_overlap(topic: str, candidates: list[str]) -> float:
    base = _norm_tokens(topic)
    if not base:
        return 0.0

    best = 0.0
    for candidate in candidates:
        other = _norm_tokens(candidate)
        if not other:
            continue
        inter = len(base & other)
        union = len(base | other)
        if union == 0:
            continue
        best = max(best, inter / union)
    return best


def parse_syllabus_text(syllabus_text: str, max_topics: int) -> dict[str, list[str]]:
    system_prompt = (
        "Extract syllabus topics and explicit learning outcomes. "
        "Return strict JSON: {\"topics\": [str], \"learning_outcomes\": [str]}."
    )
    user_prompt = f"Max topics: {max_topics}\n\nSyllabus:\n{syllabus_text}"

    try:
        raw = complete_text(system_prompt, user_prompt, temperature=0.0)
        parsed = json.loads(raw)
        topics = [str(t).strip() for t in parsed.get("topics", []) if str(t).strip()]
        outcomes = [str(t).strip() for t in parsed.get("learning_outcomes", []) if str(t).strip()]
        if topics:
            return {"topics": topics[:max_topics], "learning_outcomes": outcomes[:max_topics]}
    except Exception:
        pass

    lines = [line.strip(" -\t") for line in syllabus_text.splitlines() if line.strip()]
    topics: list[str] = []
    outcomes: list[str] = []

    for line in lines:
        lowered = line.lower()
        if any(sig in lowered for sig in {"co", "lo", "outcome", "able to", "students will"}):
            outcomes.append(line)
        elif 4 <= len(line) <= 120:
            topics.append(line)

    if not topics:
        for token in re.split(r"[,;\n]", syllabus_text):
            t = token.strip()
            if 4 <= len(t) <= 100:
                topics.append(t)
                if len(topics) >= max_topics:
                    break

    return {
        "topics": topics[:max_topics],
        "learning_outcomes": outcomes[:max_topics],
    }


def extract_taught_topic_stats(week_tag: str, max_topics: int) -> list[dict[str, Any]]:
    records = get_week_chunks(week_tag)
    docs = [str(d) for d in records.get("documents", [])]
    metas = records.get("metadatas", [])

    freq: Counter[str] = Counter()
    topic_dates: dict[str, set[str]] = defaultdict(set)

    for doc, meta in zip(docs, metas):
        date_stamp = str(meta.get("date_stamp", "")).strip()
        fragments = re.split(r"[\n\.;:]", doc)

        for fragment in fragments:
            normalized = " ".join(fragment.strip().split())
            if len(normalized) < 8 or len(normalized) > 90:
                continue
            if len(normalized.split()) > 8:
                continue

            topic = normalized.lower()
            freq[topic] += 1
            if date_stamp:
                topic_dates[topic].add(date_stamp)

    results: list[dict[str, Any]] = []
    for topic, count in freq.most_common(max_topics):
        lecture_sessions = len(topic_dates.get(topic, set()))
        lecture_time_minutes = round((count * 2.5) + (lecture_sessions * 8.0), 2)
        results.append(
            {
                "topic": topic,
                "frequency": count,
                "lecture_sessions": lecture_sessions,
                "lecture_time_minutes": lecture_time_minutes,
            }
        )
    return results


def analyze_past_papers(past_paper_text: str, max_topics: int) -> list[dict[str, Any]]:
    if not past_paper_text.strip():
        return []

    chunks = [c.strip() for c in re.split(r"[,;\n\.]", past_paper_text) if c.strip()]
    freq: Counter[str] = Counter()

    for chunk in chunks:
        topic = " ".join(chunk.split()).lower()
        if 4 <= len(topic) <= 100:
            freq[topic] += 1

    if not freq:
        words = re.findall(r"[a-zA-Z][a-zA-Z\-]{3,}", past_paper_text.lower())
        for word, count in Counter(words).most_common(max_topics):
            freq[word] = count

    return [
        {"topic": topic, "frequency": int(count)}
        for topic, count in freq.most_common(max_topics)
    ]


def compare_taught_vs_syllabus(
    taught_topic_stats: list[dict[str, Any]],
    syllabus_topics: list[str],
) -> dict[str, Any]:
    taught_topics = [str(item.get("topic", "")) for item in taught_topic_stats if str(item.get("topic", "")).strip()]

    covered = [
        topic for topic in syllabus_topics if _best_overlap(topic, taught_topics) >= 0.45
    ]
    missed = [
        topic for topic in syllabus_topics if _best_overlap(topic, taught_topics) < 0.45
    ]
    over = [
        topic for topic in taught_topics if _best_overlap(topic, syllabus_topics) < 0.45
    ]

    drift_score = round((len(missed) / max(len(syllabus_topics), 1)) * 100.0, 2)

    return {
        "covered_topics": covered[:20],
        "missed_topics": missed[:20],
        "over_emphasized_topics": over[:20],
        "drift_score_percentage": drift_score,
        "taught_topics": taught_topics,
    }


def compute_emphasis_weights(
    taught_topic_stats: list[dict[str, Any]],
    syllabus_topics: list[str],
    past_paper_topics: list[dict[str, Any]],
) -> tuple[dict[str, float], list[str]]:
    past_freq = {str(item.get("topic", "")).lower(): int(item.get("frequency", 0) or 0) for item in past_paper_topics}

    max_freq = max([int(item.get("frequency", 0) or 0) for item in taught_topic_stats] or [1])
    max_minutes = max([float(item.get("lecture_time_minutes", 0.0) or 0.0) for item in taught_topic_stats] or [1.0])
    max_past = max(list(past_freq.values()) or [1])

    keyword_weights: dict[str, float] = {}

    for item in taught_topic_stats:
        topic = str(item.get("topic", "")).strip()
        if not topic:
            continue

        frequency = int(item.get("frequency", 0) or 0)
        minutes = float(item.get("lecture_time_minutes", 0.0) or 0.0)

        freq_component = frequency / max_freq
        minutes_component = minutes / max_minutes
        past_component = past_freq.get(topic.lower(), 0) / max_past

        aligned = _best_overlap(topic, syllabus_topics) >= 0.45
        alignment_penalty = 0.1 if not aligned else 0.0

        score = 1.0 + (0.9 * freq_component) + (0.4 * minutes_component) + (0.8 * past_component) - alignment_penalty
        keyword_weights[topic] = round(min(2.8, max(0.8, score)), 2)

    priority_boost = [
        topic
        for topic, _ in sorted(keyword_weights.items(), key=lambda pair: pair[1], reverse=True)
        if _best_overlap(topic, syllabus_topics) >= 0.45 and past_freq.get(topic.lower(), 0) > 0
    ][:12]

    for topic in priority_boost[:6]:
        keyword_weights[topic] = round(min(3.0, keyword_weights[topic] + 0.2), 2)

    return keyword_weights, priority_boost


def build_alignment_report(
    *,
    week_tag: str,
    syllabus_topics: list[str],
    learning_outcomes: list[str],
    taught_topic_stats: list[dict[str, Any]],
    past_paper_topics: list[dict[str, Any]],
    comparison: dict[str, Any],
    keyword_weights: dict[str, float],
    priority_boost_topics: list[str],
) -> dict[str, Any]:
    return {
        "week_tag": week_tag,
        "official_topics": syllabus_topics,
        "learning_outcomes": learning_outcomes,
        "covered_topics": comparison["covered_topics"],
        "missed_topics": comparison["missed_topics"],
        "over_emphasized_topics": comparison["over_emphasized_topics"],
        "drift_score_percentage": comparison["drift_score_percentage"],
        "topic_emphasis": taught_topic_stats,
        "past_paper_frequency": past_paper_topics,
        "priority_topic_boosts": priority_boost_topics,
        "retrieval_weight_adjustments": keyword_weights,
    }
