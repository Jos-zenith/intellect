from dataclasses import dataclass
from pathlib import Path

from llama_parse import LlamaParse

from app.config import settings


@dataclass
class ParsedParagraph:
    paragraph_id: str
    source_file: str
    page: int
    text: str


def _split_markdown_to_paragraphs(markdown_text: str) -> list[str]:
    raw_parts = markdown_text.split("\n\n")
    return [p.strip() for p in raw_parts if p.strip()]


def parse_pdf_to_paragraphs(pdf_path: Path) -> tuple[int, list[ParsedParagraph]]:
    parser = LlamaParse(
        api_key=settings.llama_parse_api_key,
        result_type="markdown",  # type: ignore[arg-type]
        premium_mode=True,
        split_by_page=True,
    )

    documents = parser.load_data(str(pdf_path))

    paragraphs: list[ParsedParagraph] = []
    for idx, doc in enumerate(documents):
        page_num = idx + 1
        page_text = getattr(doc, "text", "")
        meta = getattr(doc, "metadata", {}) or {}
        if isinstance(meta, dict) and meta.get("page"):
            try:
                page_num = int(meta["page"])
            except (TypeError, ValueError):
                pass

        for pidx, para in enumerate(_split_markdown_to_paragraphs(page_text), start=1):
            paragraph_id = f"p{page_num}-para-{pidx}"
            paragraphs.append(
                ParsedParagraph(
                    paragraph_id=paragraph_id,
                    source_file=pdf_path.name,
                    page=page_num,
                    text=para,
                )
            )

    return len(documents), paragraphs
