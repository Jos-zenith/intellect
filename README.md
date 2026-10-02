# Intellect: Study-to-Grade copilot

An AI-native answer to **"The Academic Disconnect: Solving the Study-to-Grade Mystery"** (Design Spark Challenge: Intellect × Purple Fabric × School of Design Thinking).

Aarav's problem is that what is **taught**, what is **studied** and how answers are **graded** live in three different worlds. Intellect connects them through one knowledge base: the syllabus, the professor's dated lesson log, previous year questions with examiner notes, and the college rubrics. Claude (`claude-opus-5-5`) reasons over that knowledge base, and every answer cites its sources.

## How it answers the brief

The tabs are named for what the user is doing (*What's in my exam?*, *Where will I lose marks?*, *Ask the course*, *My class*). This table maps them back to the brief.

| Brief asks for | Where to see it | How it is enforced |
|---|---|---|
| **Logic continuity**: learning uses data from teaching | *My class* → log a class; *What's in my exam?* | Topic coverage is computed **in code** from the lesson log, not by the model. Every practice question must sit on a taught topic and cite the lesson that taught it; questions that break the rule are flagged red. **One edit ripples through:** when the teacher logs a class, the plan rebuilds immediately and a four-step chain (lesson → topic status → study session → practice question) shows exactly what changed. The diff is computed in code by comparing the two plans. On the student side the same items are marked *New*. |
| **Rubric rigor**: predict the grade from the college's rules | *Where will I lose marks?* → *How this mark was made* | Each rubric criterion is scored separately. Every rubric shows **where it came from** (department scheme of valuation), and a teacher can **paste their own rubric** for any question. Every mark needs a quote from the draft, and **each quote is checked word for word against the draft in code**: a quote that isn't there is discarded and that mark is flagged for a human. The grader first decides whether the draft **answers the question at all**; an off-topic answer is forced to 0 in code (try *Wrong answer pasted*). The **total is computed in code** and mapped to the college grade bands. Accuracy against the teacher's real marks is shown once marks are entered, and never claimed before. |
| **Knowledge base depth**: grounded in syllabus, weightage and past papers | *Ask the course* | An agent with three tools (`search_knowledge_base`, `get_exam_coverage`, `get_lesson_log`) over the syllabus with marks weightage, 24 lessons, 27 past questions with answer keys and examiner notes, rubrics and faculty notes. Click any `[ID]` chip to open the source. |
| **The ah-ha moment** | *Home* | The home page is one student's story, not a dashboard. Aarav's first draft on the canteen question is predicted at **3/10 (re-appear)**. The lines that lost marks are highlighted in his own text, next to the reasons and the 14 Aug class where the professor warned about exactly this. His rewrite scores **8.5/10**. Below that is the teacher's side: the class marked with criterion-level feedback, about 48 minutes of report writing saved, and the students below the pass line flagged while there is still time to help. |

### The 2-minute demo

1. **Home.** Tell Aarav's story from the screen: 3/10 → what the grader caught → 8.5/10, then the teacher line underneath. Click *See every mark and its source*, open *How this mark was made*, and point at "quotes found word for word" and "total added up in code".
2. **Where will I lose marks?** Click *Wrong answer pasted* → *Predict my marks*. It scores 0 and says which question the answer actually belongs to.
3. **My class** → *Fill today's class (demo)* → *Add to lesson log*. The chain appears straight away: LES-1002 → U4.T5 *Not taught yet → Taught* → study session 3 → Part B Q9 on usability testing. Click *See it as a student*: the same items are marked *New*.
4. **Ask the course** → "Is Figma prototyping coming in IA2?" shows a grounded, cited answer (needs a live API key).

Reset between runs with *Remove classes added in this demo* in *My class*.

## Demo safety: the page never waits on the API

- The home page is **prerendered static HTML** with the course, the story and the class numbers already in it, so there is no "loading" screen and nothing to fail on first paint.
- **Stored results** in `data/recorded/` answer the sample drafts and the IA2 plan (before and after the demo lesson) instantly. They are matched by the same context key as the live cache, so a stored result is only used when the inputs are identical. A changed draft, a new lesson or a teacher calibration changes the key and triggers a live call.
- **Fallback**: if a live call fails (no key, no credit, rate limit, network), a sample draft or the plan falls back to its stored result. The failure is shown next to it, and the plan is marked if it predates the latest lesson-log change.
- **Every result says where it came from**: live run, earlier identical run, recorded run, or a sample prepared offline. Each has *Run it live*.
- The stored results shipped today are **samples written by hand** in the exact output format, graded against the rubric and answer key (`origin: "authored"`), because the API key had no credit when they were made. Replace them with real recordings before presenting:

```bash
npm run dev            # with a funded ANTHROPIC_API_KEY in .env.local
npm run record         # grades every sample draft, builds the IA2 plan before and after the demo lesson
```

## Where it can fail, and what the build does about it

| Risk | What the build does | What it does not claim |
|---|---|---|
| **Handwriting and hand-drawn diagrams** are hard to judge reliably. | Students upload photos of handwritten pages (*Where will I lose marks?* → *Upload handwritten pages*). Claude **transcribes** them; it doesn't grade them. Each diagram is described with a confidence level and illegible words are marked `[illegible]`. The student **checks and corrects the transcript before grading**. Uncertain parts widen the predicted range and are listed as *needs a human check*, never guessed. | It does not grade diagrams pixel by pixel. A diagram's marks depend on its described labels and content, and low-confidence diagrams are flagged for the teacher. |
| **Teachers won't maintain clean daily data.** | *My class* → *Quick log*: paste rough notes, a slide outline or a whiteboard photo, and Claude drafts the lesson-log entry, matched to syllabus topic ids (validated in code). The teacher confirms in one click. Colleges already file a semester lesson plan, so in deployment that plan seeds the log and teachers only record deviations. | A topic is only "taught" once a teacher confirms it. The system never infers teaching from student activity. |
| **Predictions that disagree with the examiner** destroy trust. | (1) **A range, not just a point**: every criterion carries a low–high band where examiners could reasonably differ, and certainty is computed from the band width in code. (2) **Labelled as a prediction**, not an official mark, on every report. (3) **Calibration loop**: after valuation the teacher enters the real mark and, optionally, why it differs. The app shows prediction accuracy (average error, share within 10%), and the teacher's corrections become cited context (`CAL-…`) for future grading on that rubric. | Accuracy is only claimed after teacher-marked papers exist. Until then the report says there's no accuracy data yet. |

## Run it

```bash
cd docs
cp .env.example .env.local      # then paste your key: ANTHROPIC_API_KEY=sk-ant-...
npm install
npm run dev                     # http://localhost:3000
```

Browsing sources, logging lessons, the sample drafts and the demo plan work without a key. Ask, and grading or planning anything new, need one.

## Architecture

```
data/                 course.json (syllabus, weightage, exam patterns, grade bands)
                      lessons.json, pyq.json, rubrics.json, notes.json, drafts.json
lib/kb.ts             knowledge base: lesson store, coverage, BM25 retrieval
lib/claude.ts         Anthropic client, model, refusal fallback, error mapping
app/api/ask           streaming agentic RAG (tool runner, NDJSON events)
app/api/plan          study plan + practice paper (structured output) + scope check, cache + recorded fallback
app/api/grade         per-criterion grading with low-high bands (structured output), off-topic gate, quote
                      verification and score computation in code, pasted rubrics, cache + recorded fallback
app/api/transcribe    handwritten pages -> transcript with diagram confidence and unclear parts
app/api/calibration   teacher's actual marks -> accuracy stats, fed back into grading
app/api/lessons/draft rough notes or whiteboard photo -> lesson-log entry for the teacher to confirm
app/api/lessons       teacher lesson log (GET / POST / DELETE)
app/api/kb            course data, single source lookup, ?q= raw retrieval
lib/recorded.ts       stored results (data/recorded/): instant answers for identical inputs, fallback on API failure
lib/rubricText.ts     parser for rubrics pasted as text
scripts/record.mjs    records real grader and planner runs into data/recorded/
app/page.tsx          server component: renders the app with course data and the story already in the HTML
components/           App (tabs, shared state), Home (the story), Practice, Grade, Ask, Teacher + ClassDashboard,
                      planState (plan shared across tabs, lesson-change diff), classRun (class aggregation,
                      feedback reports), shared UI (citation chips, source drawer, skeletons, provenance)
```

**Retrieval** uses BM25 with domain abbreviation expansion (UX, UI, POV, HMW, SUS…), rebuilt per query so a newly logged class is searchable immediately. The corpus is small, so this needs no embedding service. For a real college-scale corpus (PDF notes, scanned papers), swap `search()` in `lib/kb.ts` for a vector store; the tool interface stays the same.

**Model calls** use `claude-opus-5-5` with adaptive thinking. Effort is `medium` for chat and planning and `high` for grading. Server-side refusal fallback (`fallbacks: "default"`) is enabled.

**Sample data**: the course is CCS370 UI and UX Design (Anna University R2021 syllabus units) at Loyola ICAM College of Engineering and Technology, taught by Ms. Accelia. The lesson log, past questions, answer keys, examiner notes and student drafts are illustrative, not real records. Replace `data/*.json` with the real lesson plan and papers to use it for real.

**Teacher-added lessons** persist to `.data/teacher-lessons.json`, or to memory on read-only hosting. For production, move them to a database.
