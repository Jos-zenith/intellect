from pathlib import Path
import re
from typing import Any, Iterable, cast

import chromadb
from chromadb.api.models.Collection import Collection

from app.config import settings
from app.llm import embed_texts
from app.parser import ParsedParagraph


COLLECTION_NAME = "ekg_notes"


def _client() -> Any:
    Path(settings.chroma_path).mkdir(parents=True, exist_ok=True)
    return cast(Any, chromadb.PersistentClient(path=settings.chroma_path))


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip().lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "default"


def _collection_name(week_tag: str | None = None) -> str:
    prefix = _slug(settings.chroma_collection_prefix or COLLECTION_NAME)
    namespace = _slug(settings.chroma_namespace)

    if settings.chroma_isolate_by_week and week_tag:
        return f"{prefix}__{namespace}__{_slug(week_tag)}"

    return f"{prefix}__{namespace}"


def get_collection(week_tag: str | None = None) -> Collection:
    client = _client()
    return client.get_or_create_collection(name=_collection_name(week_tag=week_tag))


def ensure_collection(week_tag: str | None = None) -> str:
    name = _collection_name(week_tag=week_tag)
    get_collection(week_tag=week_tag)
    return name


def _baseline_emphasis_weight(text: str) -> float:
    content = text.strip()
    lowered = content.lower()

    boost = 1.0
    if len(content) > 220:
        boost += 0.08

    signal_terms = ["important", "must", "exam", "key", "note", "remember", "rubric"]
    for term in signal_terms:
        if term in lowered:
            boost += 0.12

    return min(round(boost, 2), 2.0)


def _extract_outcome_tags(text: str) -> tuple[list[str], list[str]]:
    co_tags = sorted(set(re.findall(r"\bCO\d+\b", text, flags=re.IGNORECASE)))
    po_tags = sorted(set(re.findall(r"\bPO\d+\b", text, flags=re.IGNORECASE)))
    return [t.upper() for t in co_tags], [t.upper() for t in po_tags]


def upsert_paragraphs(
    paragraphs: Iterable[ParsedParagraph],
    week_tag: str,
    date_stamp: str | None = None,
    source_type: str = "lecture",
    source_label: str | None = None,
    knowledge_revision: int | None = None,
    uploaded_at: str | None = None,
) -> int:
    items = list(paragraphs)
    if not items:
        return 0

    texts = [i.text for i in items]
    vectors = embed_texts(texts)

    ids = [f"{week_tag}:{i.source_file}:{i.paragraph_id}" for i in items]
    metadatas: list[dict[str, str | int | float | bool]] = [
        {
            "week_tag": week_tag,
            "source_file": i.source_file,
            "page": i.page,
            "paragraph_id": i.paragraph_id,
            "paragraph_index": i.paragraph_index,
            "date_stamp": date_stamp or "",
            "uploaded_at": uploaded_at or "",
            "source_type": source_type,
            "source_label": source_label or "",
            "emphasis_weight": _baseline_emphasis_weight(i.text),
            "knowledge_revision": knowledge_revision or 0,
            "co_tags_csv": "|".join(_extract_outcome_tags(i.text)[0]),
            "po_tags_csv": "|".join(_extract_outcome_tags(i.text)[1]),
        }
        for i in items
    ]

    collection = get_collection(week_tag=week_tag)
    collection.upsert(ids=ids, embeddings=cast(Any, vectors), documents=texts, metadatas=cast(Any, metadatas))
    return len(items)


def query_context(question: str, week_tag: str | None, top_k: int, source_type: str | None = None) -> dict:
    vector = embed_texts([question])[0]
    collection = get_collection(week_tag=week_tag)

    where_payload: dict[str, Any] = {}
    if week_tag and not settings.chroma_isolate_by_week:
        where_payload["week_tag"] = week_tag
    if source_type:
        where_payload["source_type"] = source_type

    where = cast(Any, where_payload if where_payload else None)
    result = collection.query(
        query_embeddings=[vector],
        n_results=max(top_k * 3, top_k),
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    documents_group = result.get("documents") or [[]]
    metadatas_group = result.get("metadatas") or [[]]
    distances_group = result.get("distances") or [[]]
    documents = documents_group[0]
    metadatas = metadatas_group[0]
    distances = distances_group[0]

    ranked: list[tuple[float, str, dict[str, Any], float]] = []
    for doc, meta, dist in zip(documents, metadatas, distances):
        distance = float(dist) if dist is not None else 1.0
        similarity = 1.0 / (1.0 + max(distance, 0.0))
        raw_weight = meta.get("emphasis_weight", 1.0)
        emphasis_weight = float(raw_weight) if isinstance(raw_weight, (str, int, float, bool)) else 1.0
        score = similarity * emphasis_weight
        ranked.append((score, str(doc), dict(meta), distance))

    ranked.sort(key=lambda item: item[0], reverse=True)
    trimmed = ranked[:top_k]

    return {
        "documents": [[item[1] for item in trimmed]],
        "metadatas": [[item[2] for item in trimmed]],
        "distances": [[item[3] for item in trimmed]],
        "scores": [[item[0] for item in trimmed]],
    }


def get_week_chunks(week_tag: str) -> dict[str, Any]:
    collection = get_collection(week_tag=week_tag)
    where: dict[str, Any] | None = None if settings.chroma_isolate_by_week else {"week_tag": week_tag}
    return cast(
        dict[str, Any],
        collection.get(
        where=where,
        include=["documents", "metadatas", "embeddings"],
        ),
    )


def apply_keyword_emphasis(week_tag: str, keyword_weights: dict[str, float], knowledge_revision: int) -> int:
    records = get_week_chunks(week_tag)
    ids = records.get("ids", [])
    documents = records.get("documents", [])
    metadatas = records.get("metadatas", [])
    embeddings = records.get("embeddings", [])

    if not ids:
        return 0

    updated_count = 0
    out_metadatas: list[dict[str, Any]] = []
    for doc, meta in zip(documents, metadatas):
        content = doc.lower()
        boost = 1.0
        for keyword, weight in keyword_weights.items():
            if keyword.lower() in content:
                boost = max(boost, weight)

        next_meta = dict(meta)
        next_meta["emphasis_weight"] = float(boost)
        next_meta["knowledge_revision"] = int(knowledge_revision)
        out_metadatas.append(next_meta)

        if boost > 1.0:
            updated_count += 1

    collection = get_collection(week_tag=week_tag)
    collection.upsert(
        ids=ids,
        embeddings=cast(Any, embeddings),
        documents=documents,
        metadatas=cast(Any, out_metadatas),
    )
    return updated_count


def trigger_immediate_reindex(
    week_tag: str,
    reason: str,
    source_label: str | None = None,
    knowledge_revision: int | None = None,
) -> dict[str, Any]:
    records = get_week_chunks(week_tag)
    ids = records.get("ids", []) or []
    return {
        "week_tag": week_tag,
        "reason": reason,
        "source_label": source_label or "",
        "knowledge_revision": knowledge_revision,
        "indexed_chunks": len(ids),
    }
