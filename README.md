# Intellect: Study-to-Grade copilot

An AI-native answer to **"The Academic Disconnect: Solving the Study-to-Grade Mystery"** (Design Spark Challenge: Intellect × Purple Fabric × School of Design Thinking).

Aarav's problem is that what is **taught**, what is **studied** and how answers are **graded** live in three different worlds. Intellect connects them through one knowledge base: the syllabus, the professor's dated lesson log, previous year questions with examiner notes, and the college rubrics. Claude (`claude-opus-5-5`) reasons over that knowledge base, and every answer cites its sources.

## How it answers the brief

| Brief asks for | Where to see it | How it is enforced |
|---|---|---|
| **Logic continuity**: learning uses data from teaching | *Study plan & test* tab | Topic coverage is computed **in code** from the lesson log, not by the model. Every practice question must sit on a taught topic and cite the lesson that taught it; questions that break the rule are flagged red. Topics the faculty excluded (e.g. Figma prototyping, assessed in the lab record, not the IA2 paper) or hasn't taught yet are listed with the reason. |
| **Rubric rigor**: predict the grade from the college's rules | *Predict my grade* tab | Claude scores each rubric criterion separately and returns structured output with a verbatim quote from the draft as evidence. The **total is computed in code** (clamped and rounded to half marks) and mapped to the college grade bands. Citations to sources the grader wasn't given are removed. |
| **Knowledge base depth**: grounded in syllabus, weightage and past papers | *Ask* tab | An agent with three tools (`search_knowledge_base`, `get_exam_coverage`, `get_lesson_log`) over the syllabus with marks weightage, 24 lessons, 27 past questions with answer keys and examiner notes, rubrics and faculty notes. Click any `[ID]` chip to open the source. |
| **The ah-ha moment** | *Overview* (teacher snapshot); *Teacher* tab → class dashboard | One click grades the whole class: a criterion-level feedback report per student (copy or download), class gap trends per rubric criterion, at-risk flags below the pass line, and teacher time saved. **Saved from failing:** Aarav's first draft on the canteen design-thinking question is in the re-appear band: he lists textbook definitions of the five stages and writes the problem as a solution ("the canteen needs a mobile app"). The feedback points to those lines, the examiner note and the 14 Aug workshop where the professor warned about exactly this, and his rewrite moves into a passing band. |

The **Overview** tab (default) puts both sides on one screen: a *predict my grade* box where a student drops a draft and sees the predicted mark per criterion, next to the teacher's class snapshot.

### The 90-second demo

1. **Overview** → click *Aarav (first attempt)* → *Predict my marks*. Point at the score, the band and the biggest loss. Then *Full breakdown* to show the cited fixes.
2. **Overview** → *Grade the class*. Point at the at-risk count, the weak spot and the *saved from failing* card. Then *Open the class dashboard* for gap trends and downloadable reports.
3. **Study plan & test** → *Build* once. Then **Teacher** → *Fill Monday's class (demo)* → *Add to lesson log*. Back to **Study plan & test**, set *Taught up to* = 2026-10-05 and rebuild. The banner shows **New since your last plan: LES-1005**, and U4.T5 moves to *Taught*.
4. **Ask** → "Is Figma prototyping coming in IA2?" shows a grounded, cited answer.

**Warm up before presenting:** run steps 1-2 once beforehand. Grades are cached in `.data/grade-cache.json`, so during the demo they come back instantly and the scores stay identical.

## Where it can fail, and what the build does about it

| Risk | What the build does | What it does not claim |
|---|---|---|
| **Handwriting and hand-drawn diagrams** are hard to judge reliably. | Students upload photos of handwritten pages (*Predict my grade* → *Upload handwritten pages*). Claude **transcribes** them; it doesn't grade them. Each diagram is described with a confidence level and illegible words are marked `[illegible]`. The student **checks and corrects the transcript before grading**. Uncertain parts widen the predicted range and are listed as *needs a human check*, never guessed. | It does not grade diagrams pixel by pixel. A diagram's marks depend on its described labels and content, and low-confidence diagrams are flagged for the teacher. |
| **Teachers won't maintain clean daily data.** | *Teacher* → *Quick log*: paste rough notes, a slide outline or a whiteboard photo, and Claude drafts the lesson-log entry, matched to syllabus topic ids (validated in code). The teacher confirms in one click. Colleges already file a semester lesson plan, so in deployment that plan seeds the log and teachers only record deviations. | A topic is only "taught" once a teacher confirms it. The system never infers teaching from student activity. |
| **Predictions that disagree with the examiner** destroy trust. | (1) **A range, not just a point**: every criterion carries a low–high band where examiners could reasonably differ, and certainty is computed from the band width in code. (2) **Labelled as a prediction**, not an official mark, on every report. (3) **Calibration loop**: after valuation the teacher enters the real mark and, optionally, why it differs. The app shows prediction accuracy (average error, share within 10%), and the teacher's corrections become cited context (`CAL-…`) for future grading on that rubric. | Accuracy is only claimed after teacher-marked papers exist. Until then the report says there's no accuracy data yet. |

## Run it

```bash
cd docs
cp .env.example .env.local      # then paste your key: ANTHROPIC_API_KEY=sk-ant-...
npm install
npm run dev                     # http://localhost:3000
```

Browsing sources and logging lessons work without a key. Ask, plan and grade need one.

## Architecture

```
data/                 course.json (syllabus, weightage, exam patterns, grade bands)
                      lessons.json, pyq.json, rubrics.json, notes.json, drafts.json
lib/kb.ts             knowledge base: lesson store, coverage, BM25 retrieval
lib/claude.ts         Anthropic client, model, refusal fallback, error mapping
app/api/ask           streaming agentic RAG (tool runner, NDJSON events)
app/api/plan          study plan + practice paper (structured output) + scope check
app/api/grade         per-criterion grading with low-high bands (structured output) + score computation + cache
app/api/transcribe    handwritten pages -> transcript with diagram confidence and unclear parts
app/api/calibration   teacher's actual marks -> accuracy stats, fed back into grading
app/api/lessons/draft rough notes or whiteboard photo -> lesson-log entry for the teacher to confirm
app/api/lessons       teacher lesson log (GET / POST / DELETE)
app/api/kb            course data, single source lookup, ?q= raw retrieval
components/           Overview, Ask, Practice, Grade, Teacher + ClassDashboard, classRun (class aggregation,
                      feedback reports), shared UI (citation chips, source drawer)
```

**Retrieval** uses BM25 with domain abbreviation expansion (UX, UI, POV, HMW, SUS…), rebuilt per query so a newly logged class is searchable immediately. The corpus is small, so this needs no embedding service. For a real college-scale corpus (PDF notes, scanned papers), swap `search()` in `lib/kb.ts` for a vector store; the tool interface stays the same.

**Model calls** use `claude-opus-5-5` with adaptive thinking. Effort is `medium` for chat and planning and `high` for grading. Server-side refusal fallback (`fallbacks: "default"`) is enabled.

**Sample data**: the course is CCS370 UI and UX Design (Anna University R2021 syllabus units) at Loyola ICAM College of Engineering and Technology, taught by Ms. Accelia. The lesson log, past questions, answer keys, examiner notes and student drafts are illustrative, not real records. Replace `data/*.json` with the real lesson plan and papers to use it for real.

**Teacher-added lessons** persist to `.data/teacher-lessons.json`, or to memory on read-only hosting. For production, move them to a database.
