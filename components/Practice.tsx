"use client";

import type { AssessmentId, Course } from "@/lib/types";
import { questionKey, type CoverageRow, type PlanState, type PracticeQuestion } from "./planState";
import { CiteList, ErrorNote, ProvenanceNote, RichText, Skeleton } from "./ui";

const STATUS = {
  taught: { mark: "✓", text: "Taught", style: "text-good" },
  excluded: { mark: "✗", text: "Not in this exam", style: "text-warn" },
  "not-taught": { mark: "○", text: "Not taught yet", style: "text-muted" },
} as const;

const STATUS_TEXT = { taught: "Taught", excluded: "Excluded", "not-taught": "Not taught yet", absent: "Not in the syllabus" } as const;

/** The examiner's red-pen note for anything a newly logged class changed. */
function PenNew({ children = "new" }: { children?: string }) {
  return <span className="red-pen -rotate-2 whitespace-nowrap text-[15px] leading-none">{children}</span>;
}

export function Practice({
  course,
  state,
  onAnswer,
}: {
  course: Course;
  state: PlanState;
  onAnswer: (q: { text: string; marks: number }) => void;
}) {
  const { plan, changes, trigger, busy, error, build, assessmentId, asOf } = state;
  const exams = course.assessments.filter((a) => a.date >= course.today);
  const newSessions = new Set(changes?.sessions);
  const newQuestions = new Set(changes?.questions);
  const flipped = new Set(changes?.flipped.map((f) => f.topicId));
  const select = "rounded-md border border-line bg-panel px-2.5 py-1.5 text-sm";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <label className="flex items-center gap-2">
          Exam
          <select value={assessmentId} onChange={(e) => build({ assessmentId: e.target.value as AssessmentId })} className={select}>
            {exams.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.date}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Classes up to
          <input type="date" value={asOf} onChange={(e) => e.target.value && build({ asOf: e.target.value })} className={select} />
        </label>
        <span className="text-xs">Built only from what {course.faculty} has logged as taught.</span>
      </div>

      {error && <ErrorNote message={error} />}
      {busy && !plan && <Skeleton lines={8} />}

      {plan && (
        <div className={`flex flex-col gap-10 transition-opacity ${busy ? "opacity-50" : ""}`}>
          <div>
            <h1 className="max-w-4xl font-serif text-[2rem] font-bold leading-tight tracking-tight sm:text-[2.4rem]">
              {plan.assessment.name} is in {plan.daysLeft} days. {plan.coverage.filter((c) => c.status === "taught").length} of {plan.coverage.length} topics
              can be asked.
            </h1>
            <p className={`mt-2 text-[15px] ${plan.check.outOfScope ? "text-bad" : "text-muted"}`}>
              {plan.check.outOfScope
                ? `${plan.check.outOfScope} practice question(s) sit on topics that haven't been taught. They are marked below.`
                : `Your practice paper below is ${plan.check.totalMarks} marks, in the real pattern, and every question is on a topic taught in class.`}
            </p>
          </div>

          {changes && (
            <div className="border-l-4 border-red-pen pl-5">
              <p className="font-serif text-lg font-semibold">
                {trigger ? `${course.faculty} logged "${trigger.title}"` : "New in the lesson log"} <CiteList ids={changes.newLessons} />
              </p>
              <ul className="mt-1 space-y-0.5 text-[15px] text-muted">
                {changes.flipped.map((f) => (
                  <li key={f.topicId}>
                    <span className="text-ink">{f.topicId}</span> {f.name}: {STATUS_TEXT[f.from]} → <span className="font-medium text-good">{STATUS_TEXT[f.to]}</span>
                  </li>
                ))}
                <li>
                  Study plan: {changes.sessions.length ? `session ${changes.sessions.join(" and ")} now build${changes.sessions.length > 1 ? "" : "s"} on it` : "no session uses it yet"}.
                  Practice paper:{" "}
                  {changes.questions.length ? `${changes.questions.map((k) => `Q${k.split("-")[1]}`).join(", ")} ${changes.questions.length > 1 ? "are" : "is"} new` : "unchanged"}. Look for
                  the red <PenNew />.
                </li>
              </ul>
            </div>
          )}

          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section>
              <h2 className="font-serif text-xl font-semibold">The syllabus, as taught</h2>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {plan.coverage.map((c) => (
                  <CoverageLine key={c.topicId} c={c} fresh={flipped.has(c.topicId)} />
                ))}
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-xl font-semibold">Where the marks are, highest first</h2>
              <ol className="mt-3 space-y-4">
                {plan.priorities.map((p, i) => (
                  <li key={p.topicId} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 text-sm">
                    <span className="font-serif text-lg font-bold leading-6 text-accent">{i + 1}</span>
                    <div>
                      <p className="font-medium">
                        {p.topicName} {flipped.has(p.topicId) && <PenNew />}
                      </p>
                      <p className="mt-0.5 leading-relaxed text-muted">{p.why}</p>
                      <div className="mt-1">
                        <CiteList ids={p.sourceIds} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <section>
            <h2 className="font-serif text-xl font-semibold">Study plan for the {plan.daysLeft} days left</h2>
            <ol className="mt-3 flex flex-wrap gap-4">
              {plan.studyPlan.map((s) => (
                <li key={s.session} className={`min-w-0 grow basis-72 rounded-md border bg-panel p-4 text-sm ${newSessions.has(s.session) ? "border-red-pen/60" : "border-line"}`}>
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-serif text-xs font-semibold uppercase tracking-wider text-muted">Session {s.session}</span>
                    {newSessions.has(s.session) && <PenNew />}
                  </p>
                  <p className="mt-1 font-medium">{s.focus}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
                    {s.tasks.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                  <div className="mt-2">
                    <CiteList ids={s.sourceIds} />
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <QuestionPaper course={course} plan={plan} newQuestions={newQuestions} onAnswer={onAnswer} />
          <div className="-mt-6 flex justify-center">
            <ProvenanceNote of={plan} onRunLive={() => build({ live: true })} busy={busy} />
          </div>
        </div>
      )}
    </div>
  );
}

function CoverageLine({ c, fresh }: { c: CoverageRow; fresh: boolean }) {
  const s = STATUS[c.status];
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-2 py-2 text-sm">
      <span className={`text-base font-semibold ${s.style}`} title={s.text}>
        {s.mark}
      </span>
      <span className={c.status === "taught" ? "" : "text-muted"}>
        <span className="mr-1.5 font-mono text-xs text-muted">{c.topicId}</span>
        {c.name}
        {c.status !== "taught" && <span className="block text-xs">{c.reason}</span>}
      </span>
      <span className="flex items-baseline gap-2 text-right">
        {fresh && <PenNew />}
        {c.status === "taught" && <CiteList ids={c.lessonIds} />}
      </span>
    </li>
  );
}

/** The practice test, laid out like the printed internal-assessment paper. */
function QuestionPaper({
  course,
  plan,
  newQuestions,
  onAnswer,
}: {
  course: Course;
  plan: NonNullable<PlanState["plan"]>;
  newQuestions: Set<string>;
  onAnswer: (q: { text: string; marks: number }) => void;
}) {
  const parts = plan.assessment.pattern.map((p) => ({ ...p, questions: plan.practiceTest.filter((q) => q.part === p.part) }));
  return (
    <section className="paper mx-auto w-full max-w-4xl rounded-sm px-6 py-8 sm:px-12">
      <header className="border-b-2 border-paper-ink/70 pb-4 text-center">
        <p className="font-serif text-xs font-semibold uppercase tracking-[0.18em] text-paper-ink/70">{course.college}</p>
        <p className="mt-2 font-serif text-xl font-bold uppercase tracking-wide">{plan.assessment.name} · Practice paper</p>
        <p className="mt-1 font-serif text-sm">
          {course.code} {course.title}
        </p>
        <div className="mt-3 flex justify-between font-serif text-sm">
          <span>Time: 90 minutes</span>
          <span>Maximum marks: {plan.assessment.total}</span>
        </div>
      </header>
      <p className="mt-3 text-center text-xs text-paper-ink/60">
        Set from {course.faculty}&apos;s lesson log up to {plan.asOf}. Every question is on a topic taught in class; the line under each says where.
      </p>

      {parts.map((p) => (
        <div key={p.part} className="mt-7">
          <p className="text-center font-serif text-[15px] font-bold uppercase tracking-wide">
            Part {p.part} <span className="font-normal normal-case tracking-normal">({p.count} × {p.marks} = {p.count * p.marks} marks)</span>
          </p>
          <p className="text-center font-serif text-xs italic text-paper-ink/60">{p.note}</p>
          <ol className="mt-4 space-y-5">
            {p.questions.map((q) => (
              <PaperQuestion key={questionKey(q)} q={q} fresh={newQuestions.has(questionKey(q))} onAnswer={onAnswer} />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

function PaperQuestion({ q, fresh, onAnswer }: { q: PracticeQuestion; fresh: boolean; onAnswer: (q: { text: string; marks: number }) => void }) {
  return (
    <li className={`relative grid grid-cols-[2rem_minmax(0,1fr)_2.5rem] gap-x-2 ${q.problems.length ? "rounded bg-bad-soft p-2" : ""}`}>
      {fresh && (
        <span className="absolute -left-14 top-0 hidden sm:block">
          <PenNew>new →</PenNew>
        </span>
      )}
      <span className="font-serif font-semibold">{q.number}.</span>
      <div>
        <div className="font-serif text-[15.5px] leading-relaxed">
          <RichText text={q.question} />
        </div>
        {fresh && (
          <p className="red-pen sm:hidden">
            <PenNew>new from the latest class</PenNew>
          </p>
        )}
        <p className="mt-1 text-xs leading-relaxed text-paper-ink/65">
          <span className="font-medium text-paper-ink/80">Examiner looks for:</span> {q.examinerLooksFor} · Taught in <CiteList ids={q.basedOnLessons} />
          {q.similarPyqs.length > 0 && (
            <>
              {" "}
              · Like <CiteList ids={q.similarPyqs} />
            </>
          )}{" "}
          ·{" "}
          <button onClick={() => onAnswer({ text: q.question, marks: q.marks })} className="font-medium text-accent hover:underline">
            Answer it →
          </button>
        </p>
        {q.problems.length > 0 && <p className="mt-1 text-xs font-medium text-bad">Not taught yet, so it shouldn&apos;t be here: {q.problems.join("; ")}</p>}
      </div>
      <span className="text-right font-serif text-sm">({q.marks})</span>
    </li>
  );
}
