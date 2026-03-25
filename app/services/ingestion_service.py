from datetime import datetime
from pathlib import Path

from app.audit import log_event
from app.config import settings
from app.models import IngestResponse
from app.parser import parse_pdf_to_paragraphs
from app.storage import upsert_paragraphs


def ingest_pdf(file_name: str, file_bytes: bytes, week_tag: str | None = None) -> IngestResponse:
    now = datetime.utcnow()
    week = week_tag or now.strftime("%Y-W%U")

    upload_dir = Path(settings.upload_path)
    upload_dir.mkdir(parents=True, exist_ok=True)
    target_path = upload_dir / file_name
    target_path.write_bytes(file_bytes)

    pages_parsed, paragraphs = parse_pdf_to_paragraphs(target_path)
    indexed = upsert_paragraphs(
        paragraphs,
        week,
        date_stamp=now.date().isoformat(),
        source_type="lecture",
    )

    log_event(
        "ingest.completed",
        {
            "file_name": file_name,
            "week_tag": week,
            "pages_parsed": pages_parsed,
            "paragraphs_indexed": indexed,
        },
    )

    return IngestResponse(
        file_name=file_name,
        week_tag=week,
        pages_parsed=pages_parsed,
        paragraphs_indexed=indexed,
    )
