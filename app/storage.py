from pathlib import Path
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


def get_collection() -> Collection:
    client = _client()
    return client.get_or_create_collection(name=COLLECTION_NAME)


def upsert_paragraphs(
    paragraphs: Iterable[ParsedParagraph],
    week_tag: str,
    date_stamp: str | None = None,
    source_type: str = "lecture",
    knowledge_revision: int | None = None,
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
            "date_stamp": date_stamp or "",
            "source_type": source_type,
            "emphasis_weight": 1.0,
            "knowledge_revision": knowledge_revision or 0,
        }
        for i in items
    ]

    collection = get_collection()
    collection.upsert(ids=ids, embeddings=cast(Any, vectors), documents=texts, metadatas=cast(Any, metadatas))
    return len(items)


def query_context(question: str, week_tag: str | None, top_k: int) -> dict:
    vector = embed_texts([question])[0]
    collection = get_collection()

    where = cast(Any, {"week_tag": week_tag} if week_tag else None)
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
    collection = get_collection()
    return cast(
        dict[str, Any],
        collection.get(
        where={"week_tag": week_tag},
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

    collection = get_collection()
    collection.upsert(
        ids=ids,
        embeddings=cast(Any, embeddings),
        documents=documents,
        metadatas=cast(Any, out_metadatas),
    )
    return updated_count
