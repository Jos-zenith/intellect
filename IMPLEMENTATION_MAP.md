# Purple Fabric Architecture: Converting Capability into Consequence

This document translates Aarav's four challenge requirements into a decision-grade implementation that is already wired in this workspace.

## System Blueprint

Purple Fabric Stack Mapping in this MVP:

- Enterprise Knowledge Garden (EKG): `app/parser.py`, `app/storage.py`, `app/services/ingestion_service.py`
- Enterprise Digital Expert (EDE): `app/personas.py`, `app/services/qa_service.py`
- Automated Question Paper Generation System (AQPGS): `app/services/exam_service.py`
- Enterprise Governance (EG): `app/services/qa_service.py`, `app/audit.py`, `app/main.py`
- User Experience Layer (iTurmeric-equivalent composability): `web/index.html`, `web/app.js`, `web/styles.css`

## Requirement 1: Logic Continuity (Teaching to Learning Bridge)

Objective:
Ensure Monday teaching updates are immediately reflected in Tuesday learning plans and tutoring.

Mechanism on Purple Fabric:

- High-fidelity ingestion through LlamaParse with layout-aware markdown extraction
- Paragraph-level lineage IDs (`p{page}-para-{index}`) to preserve context granularity
- Immediate post-upload re-indexing to the vector store
- Week-tag filters to keep study outputs synchronized to current classroom context

Workspace Implementation:

- OCR and page/paragraph parsing: `app/parser.py`
- Ingestion API and immediate indexing trigger: `POST /api/ingest` in `app/main.py`
- Vector upsert and retrieval: `app/storage.py`
- Ingestion orchestration + audit event: `app/services/ingestion_service.py`

Outcome:
When faculty uploads revised notes, the tutor stops serving stale context and pivots to the latest teaching emphasis.

## Requirement 2: Rubric Rigor (GPS for Improvement)

Objective:
Move from opaque grades to explainable, rule-aligned feedback with clear loss-of-marks reasoning.

Mechanism on Purple Fabric:

- Deterministic grounded answering: no retrieved context means no speculative answer
- Persona-routed Socratic dialogue for guided correction
- Structured answer lineage for traceability
- Model policy centralization for stable behavior and tuning

Workspace Implementation:

- Head-agent routing and six personas: `app/personas.py`
- Grounded QA pipeline with citation binding: `app/services/qa_service.py`
- Central model configuration: `app/config.py` (default `OPENAI_MODEL=o1-preview`)
- Chat endpoint: `POST /api/chat` in `app/main.py`

Outcome:
Each response includes evidence lineage, so learners can see exactly where logic or presentation gaps originated.

## Requirement 3: Knowledge Base Depth (Beyond One-Shot Surface)

Objective:
Build syllabus-faithful depth using institutional sources rather than generic internet summaries.

Mechanism on Purple Fabric:

- Context refinery sequence:
  1. ingest
  2. parse and structure
  3. embed and index
  4. validate with retrieval-time citations
- Week-scoped context retrieval for syllabus coherence
- Grounding constraints for both tutoring and exam generation

Workspace Implementation:

- Retrieval and week filtering: `app/storage.py`
- Context-grounded tutoring generation: `app/services/qa_service.py`
- Context-grounded mock paper generation: `app/services/exam_service.py`

Outcome:
Students receive preparation aligned to actual teaching signals, marks weightage context, and current-week emphasis.

## Requirement 4: The Ah-ha Moment (Detecting and Enabling Insight)

Objective:
Create measurable instructional moments where confusion is resolved through guided Socratic progression, while reducing faculty documentation burden.

Mechanism on Purple Fabric:

- Persona-specific Socratic prompts (`Why`, `What if`) for conceptual bridges
- Citation-first responses to reinforce confidence and verification
- Full activity audit trail for educational and governance review

Workspace Implementation:

- Socratic persona prompt templates: `app/personas.py`
- Response generation with source lineage: `app/services/qa_service.py`
- Event-level observability and audit storage: `app/audit.py`
- Audit API for administrators: `GET /api/audit/recent` in `app/main.py`

Outcome:
Learners experience guided conceptual breakthroughs, and faculty gets machine-generated evidence trails instead of manual reconstruction.

## Velocity Synchronization Engine (Monday-Tuesday-Wednesday Loop)

Monday/Tuesday Sync:

- Faculty uploads notes via UI or API
- System parses with LlamaParse and re-indexes immediately
- Chat retrieval for the same `week_tag` uses only updated chunks

Wednesday Mock Exam:

- AQPGS request targets a specific `week_tag`
- Questions are generated strictly from retrieved weekly context
- Each question carries source lineage references for verification

Endpoints:

- `POST /api/ingest`
- `POST /api/chat`
- `POST /api/exam/generate`
- `GET /api/audit/recent`

## Governance and Decision-Grade Verification

Guardrails currently enforced:

- No-context block to reduce hallucination risk
- Source lineage attached to answer artifacts
- Persistent event trail for ingest, chat, and exam operations

Auditability by design evidence:

- Ingest event includes file, week tag, pages parsed, paragraphs indexed
- Chat event includes routed persona, week tag, citation count
- Exam event includes requested vs generated item count

Storage and exposure:

- SQLite event store: `app/audit.py`
- API retrieval for compliance review: `GET /api/audit/recent`

## Judge Demo Script (8-10 Minutes)

1. Upload fresh faculty notes for `2026-W12`.
2. Show immediate ingestion metadata and indexed paragraph count.
3. Ask a tutoring question and highlight persona routing plus lineage references.
4. Generate Wednesday mock for `2026-W12` and inspect lineage per question.
5. Open audit trail and replay the full decision sequence end-to-end.
6. Remove week tag or upload nothing, then show safe fallback behavior.

## Success Criteria

- Logic Continuity: New upload affects retrieval immediately in the same session.
- Rubric Rigor: Feedback is grounded and explainable with source lineage.
- Knowledge Depth: Outputs reflect weekly institutional context, not generic priors.
- Ah-ha Enablement: Socratic tutoring plus auditable evidence supports measurable learning intervention.
