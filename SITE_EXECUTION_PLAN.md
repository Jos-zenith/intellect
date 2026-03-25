# 8:00 AM Site Execution Plan: Agile RAG Orchestrator

## Mission

Deliver a demo-ready web experience by 8:00 AM that proves the complete Monday-Tuesday-Wednesday learning loop without proprietary Purple Fabric services.

## Open-Source Core Infrastructure

This is the replacement architecture to present on the website and implement in code.

- Vector Database (Knowledge Garden): Pinecone or Milvus for real-time upserts
- RAG Orchestration Layer: LangChain or LlamaIndex for ingestion and retrieval flow
- Agentic Runtime: CrewAI or LangGraph for multi-agent routing and control
- LLM + Embeddings: OpenAI models with strict grounded prompts
- API Layer: FastAPI (already in project)
- Audit Store: SQLite initially, then Mongo/Postgres optional upgrade

## Pillar 1: Judgment-Centric Multi-Agent Orchestration

### Website Narrative Block

Show a Team of Experts, not a single bot.

### Agent Squad to Display

- Syllabus Sentinel: detects teaching-vs-syllabus drift
- Socratic Sensei: runs guided first-principles dialogue
- Rubric Referee: predicts grade by deterministic college rubric logic
- Accreditation Analyst: compiles audit evidence for NBA/NAAC
- Performance Forecaster: detects student study drift and risk signals
- Marks Optimizer: applies 80/20 prioritization for high-weightage topics

### Logic Layer to Implement

- Master Router classifies user state and routes to one specialist agent
- Each agent returns structured output with persona, action plan, and evidence links
- Rubric Referee must return JSON loss-run format for explainability

## Pillar 2: Solve Documentation Purgatory for Professors

### Website Narrative Block

Position AI as workload remover for faculty.

### Impact Table to Display

- CO-PO Mapping: automated attainment mapping from test artifacts
- CIE Documentation: continuous evidence trail instead of last-minute compilation
- Remedial Intervention: early warning system for at-risk students
- Self-Study Reports: auto-generated narrative draft from evidence graph

### Proof Widget to Build

- Timeline view from audit events
- Outcome chips: hours saved, pending actions, risk flags

## Pillar 3: Enterprise AI on Tap (Production Readiness)

### Website Narrative Block

Show this as institutional infrastructure, not a hackathon prototype.

### Readiness Checklist to Display

- Proprietary data protection and entitlement boundaries
- Governance and lineage for every answer
- Compliance posture references (ISO 42001, ISO 27017 alignment targets)
- Integration-ready connectors for LMS/ERP/exam databases

### Technical Signals to Expose

- Health endpoint status
- Retrieval coverage and citation count
- Audit event count by operation type

## Monday-Tuesday-Wednesday Core Loop

## Monday: Ingestion

- Accept lecture PDFs and transcripts
- Parse and chunk
- Upsert with date_stamp, week_tag, and source lineage metadata

Current API basis:

- POST /api/ingest

## Tuesday: Alignment

- Run Syllabus Sentinel drift check (taught topics vs syllabus topics)
- Boost retrieval priority for emphasized topics
- Record drift and weight adjustments in audit log

Implementation target:

- New endpoint: POST /api/alignment/run

## Wednesday: Execution

- Rubric Referee generates mock exam from updated weighted chunks only
- Return question-level lineage and rubric tags

Current API basis:

- POST /api/exam/generate

## Site Information Architecture

1. Hero: Study-to-Grade Mystery
2. Pillar 1: Multi-Agent Orchestration
3. Pillar 2: Faculty Documentation Relief
4. Pillar 3: Production Readiness
5. Live Core Loop Demo (Monday-Tuesday-Wednesday)
6. Governance and Audit Trail
7. Judge Checklist and Final Impact

## Frontend Build Plan

## Phase A (45 mins): Structure

- Replace current utility grid with narrative sections and sticky nav
- Keep live controls embedded inside the Core Loop section

Files:

- web/index.html

## Phase B (60 mins): Interaction

- Refactor event handlers into section modules
- Add persona router panel and loss-run viewer
- Convert audit raw JSON into timeline cards

Files:

- web/app.js

## Phase C (60 mins): Visual Language

- Build academic-enterprise visual system
- Add pillar cards, loop stepper, compliance checklist, timeline
- Ensure responsive behavior for mobile and desktop

Files:

- web/styles.css

## Backend Extension Plan

## Phase D (60 mins): Agile RAG Upgrades

- Add vector abstraction to switch Chroma to Pinecone/Milvus
- Add router policy object for six agents
- Add Tuesday alignment endpoint and audit events
- Add rubric loss-run JSON response contract

Files:

- app/storage.py
- app/services/qa_service.py
- app/services/exam_service.py
- app/main.py
- app/models.py

## Acceptance Criteria for 8:00 AM

1. Site clearly explains all three pillars and the full Monday-Tuesday-Wednesday loop.
2. Live ingest -> chat -> exam -> audit run works from one page.
3. At least one output shows rubric loss-run JSON and source lineage.
4. Audit timeline demonstrates institutional traceability.
5. Design is presentation-grade on desktop and mobile.

## Execution Sequence Right Now

1. Build the narrative site shell in web/index.html.
2. Upgrade app.js to render persona routing, loss-run, and timeline views.
3. Redesign styles.css for pitch-grade storytelling UI.
4. Add Tuesday alignment API and placeholder scoring logic.
5. Dry-run the demo script end-to-end.
