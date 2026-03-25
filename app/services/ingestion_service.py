from datetime import datetime
from pathlib import Path
import re
from app.audit import log_event
from app.config import settings
from app.knowledge_versioning import create_knowledge_revision
from app.models import IngestResponse, IngestTextRequest, IngestTextResponse
from app.parser import ParsedParagraph, parse_pdf_to_paragraphs
from app.storage import upsert_paragraphs


def _split_text_to_paragraphs(text: str, source_file: str) -> list[ParsedParagraph]:
    parts = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not parts:
        parts = [text.strip()] if text.strip() else []

    return [
        ParsedParagraph(
            paragraph_id=f"text-para-{idx}",
            source_file=source_file,
            page=1,
            paragraph_index=idx,
            text=chunk,
        )
        for idx, chunk in enumerate(parts, start=1)
    ]


def ingest_pdf(file_name: str, file_bytes: bytes, week_tag: str | None = None) -> IngestResponse:
    now = datetime.utcnow()
    week = week_tag or now.strftime("%Y-W%U")

    upload_dir = Path(settings.upload_path)
    upload_dir.mkdir(parents=True, exist_ok=True)
    target_path = upload_dir / file_name
    target_path.write_bytes(file_bytes)

    pre_revision = create_knowledge_revision(
        week_tag=week,
        stage="ingest.pdf.started",
        summary={"file_name": file_name, "date_stamp": now.date().isoformat()},
    )

    pages_parsed, paragraphs = parse_pdf_to_paragraphs(target_path)
    indexed = upsert_paragraphs(
        paragraphs,
        week,
        date_stamp=now.date().isoformat(),
        uploaded_at=now.isoformat(),
        source_type="lecture",
        knowledge_revision=pre_revision,
    )

    revision = create_knowledge_revision(
        week_tag=week,
        stage="ingest.pdf.completed",
        summary={"file_name": file_name, "pages_parsed": pages_parsed, "paragraphs_indexed": indexed},
    )

    log_event(
        "ingest.completed",
        {
            "file_name": file_name,
            "week_tag": week,
            "pages_parsed": pages_parsed,
            "paragraphs_indexed": indexed,
            "knowledge_revision": revision,
        },
    )

    return IngestResponse(
        file_name=file_name,
        week_tag=week,
        pages_parsed=pages_parsed,
        paragraphs_indexed=indexed,
        source_type="lecture_pdf",
        knowledge_revision=revision,
        date_stamp=now.date().isoformat(),
    )


def ingest_text(request: IngestTextRequest) -> IngestTextResponse:
    now = datetime.utcnow()
    week = request.week_tag or now.strftime("%Y-W%U")
    date_stamp = request.date_stamp or now.date().isoformat()
    source_file = f"{request.source_label}.txt"

    pre_revision = create_knowledge_revision(
        week_tag=week,
        stage="ingest.text.started",
        summary={"source_label": request.source_label, "date_stamp": date_stamp},
    )

    paragraphs = _split_text_to_paragraphs(request.text, source_file)
    indexed = upsert_paragraphs(
        paragraphs,
        week,
        date_stamp=date_stamp,
        uploaded_at=now.isoformat(),
        source_type=request.source_type,
        knowledge_revision=pre_revision,
    )

    revision = create_knowledge_revision(
        week_tag=week,
        stage="ingest.text.completed",
        summary={"source_label": request.source_label, "paragraphs_indexed": indexed, "date_stamp": date_stamp},
    )

    log_event(
        "ingest.text.completed",
        {
            "source_label": request.source_label,
            "week_tag": week,
            "paragraphs_indexed": indexed,
            "source_type": request.source_type,
            "knowledge_revision": revision,
        },
    )

    return IngestTextResponse(
        source_label=request.source_label,
        week_tag=week,
        date_stamp=date_stamp,
        paragraphs_indexed=indexed,
        knowledge_revision=revision,
    )
