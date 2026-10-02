"use client";

import type { AssessmentId, Course } from "@/lib/types";
import { questionKey, type PlanState } from "./planState";
import { Button, CiteList, ErrorNote, Label, Panel, ProvenanceNote, RichText, Skeleton } from "./ui";

const STATUS_STYLE = {
  taught: "bg-good-soft text-good",
  excluded: "bg-warn-soft text-warn",
  "not-taught": "bg-sunken text-muted",
} as const;

const STATUS_TEXT = { taught: "Taught", excluded: "Excluded", "not-taught": "Not taught yet" } as const;

const NEW_RING = "ring-2 ring-accent/60";

function NewBadge() {
  return <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white dark:text-[#131210]">New</span>;
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

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label>Exam</Label>
            <select
              value={assessmentId}
              onChange={(e) => build({ assessmentId: e.target.value as AssessmentId })}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm"
            >
              {exams.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.date}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Classes up to</Label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => e.target.value && build({ asOf: e.target.value })}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={() => build({ live: true })} disabled={busy} variant="ghost">
            {busy ? "Building…" : "Rebuild live"}
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          Built only from what {course.faculty} has logged as taught. When a new class is logged, this page rebuilds and marks what changed.
        </p>
      </Panel>

      {error && <ErrorNote message={error} />}

      {busy && !plan && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <Skeleton lines={5} />
          </Panel>
          <Panel>
            <Skeleton lines={5} />
          </Panel>
        </div>
      )}

      {plan && (
        <div className={`flex flex-col gap-4 transition-opacity ${busy ? "opacity-50" : ""}`}>
          {changes && (
            <div className="rounded-xl border border-accent/40 bg-accent-soft px-5 py-3 text-sm">
              <p>
                <span className="font-medium text-accent">
                  {trigger ? `${course.faculty} logged "${trigger.title}"` : "New in the lesson log"}
                </span>{" "}
                <CiteList ids={changes.newLessons} />
              </p>
              <ul className="mt-1.5 space-y-0.5 text-muted">
                {changes.flipped.map((f) => (
                  <li key={f.topicId}>
                    <span className="text-ink">{f.topicId}</span> {f.name}: {f.from === "absent" ? "new" : STATUS_TEXT[f.from]} → <span className="font-medium text-ink">{STATUS_TEXT[f.to]}</span>
                  </li>
                ))}
                <li>
                  Study plan: {changes.sessions.length ? `session ${changes.sessions.join(", ")} now builds on it` : "no session uses it yet"}. Practice test:{" "}
                  {changes.questions.length ? `${changes.questions.map((k) => k.replace("-", " Q")).join(", ")} ${changes.questions.length > 1 ? "are" : "is"} new` : "unchanged"}.
                </li>
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Days to exam" value={String(plan.daysLeft)} />
            <Stat label="Topics you can be asked" value={`${plan.coverage.filter((c) => c.status === "taught").length}/${plan.coverage.length}`} />
            <Stat label="Paper marks" value={`${plan.check.totalMarks}/${plan.check.expectedMarks}`} ok={plan.check.totalMarks === plan.check.expectedMarks} />
            <Stat label="Questions on untaught topics" value={String(plan.check.outOfScope)} ok={plan.check.outOfScope === 0} />
          </div>

          <Panel>
            <Label>
              What can be in {plan.assessment.name} as of {plan.asOf}
            </Label>
            <div className="divide-y divide-line">
              {plan.coverage.map((c) => (
                <div
                  key={c.topicId}
                  className={`flex flex-col gap-1 rounded py-2 sm:flex-row sm:items-center sm:gap-3 ${flipped.has(c.topicId) ? "bg-accent-soft px-2" : ""}`}
                >
                  <span className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>{STATUS_TEXT[c.status]}</span>
                  <span className="font-mono text-xs text-muted">{c.topicId}</span>
                  <span className="flex-1 text-sm">{c.name}</span>
                  {flipped.has(c.topicId) && <NewBadge />}
                  <span className="text-xs text-muted">{c.status === "taught" ? <CiteList ids={c.lessonIds} /> : c.reason}</span>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <Label>Where the marks are, highest first</Label>
              <ol className="space-y-3">
                {plan.priorities.map((p, i) => (
                  <li key={p.topicId} className="flex gap-3">
                    <span className="mt-0.5 font-mono text-sm text-accent">{i + 1}</span>
                    <div className="text-sm">
                      <p className="font-medium">
                        {p.topicName} {flipped.has(p.topicId) && <NewBadge />}
                      </p>
                      <p className="mt-0.5 text-muted">{p.why}</p>
                      <div className="mt-1">
                        <CiteList ids={p.sourceIds} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
            <Panel>
              <Label>Study plan</Label>
              <ol className="space-y-4">
                {plan.studyPlan.map((s) => (
                  <li key={s.session} className={`rounded-lg text-sm ${newSessions.has(s.session) ? `${NEW_RING} p-2` : ""}`}>
                    <p className="font-medium">
                      <span className="text-accent">Session {s.session}.</span> {s.focus} {newSessions.has(s.session) && <NewBadge />}
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                      {s.tasks.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                    <div className="mt-1">
                      <CiteList ids={s.sourceIds} />
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>

          <Panel>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <Label>
                Practice paper · {plan.assessment.name} · {plan.check.totalMarks} marks
              </Label>
              <ProvenanceNote of={plan} onRunLive={() => build({ live: true })} busy={busy} />
            </div>
            <div className="space-y-3">
              {plan.practiceTest.map((q) => (
                <div
                  key={questionKey(q)}
                  className={`rounded-lg border p-4 ${q.problems.length ? "border-bad/40 bg-bad-soft" : "border-line"} ${newQuestions.has(questionKey(q)) ? NEW_RING : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-semibold">
                      Part {q.part} · Q{q.number}
                    </span>
                    <span className="rounded bg-sunken px-1.5 py-0.5">{q.marks} marks</span>
                    <span className="text-muted">{q.topicName}</span>
                    {newQuestions.has(questionKey(q)) && <NewBadge />}
                  </div>
                  <div className="mt-2 text-sm">
                    <RichText text={q.question} />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    <span className="font-medium text-ink">Examiner looks for:</span> {q.examinerLooksFor}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span>
                      Taught in <CiteList ids={q.basedOnLessons} />
                    </span>
                    {q.similarPyqs.length > 0 && (
                      <span>
                        Similar to <CiteList ids={q.similarPyqs} />
                      </span>
                    )}
                    <button onClick={() => onAnswer({ text: q.question, marks: q.marks })} className="ml-auto text-accent hover:underline">
                      Answer it and see your marks →
                    </button>
                  </div>
                  {q.problems.length > 0 && <p className="mt-2 text-xs font-medium text-bad">Not taught yet, so it shouldn&apos;t be here: {q.problems.join("; ")}</p>}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${ok === false ? "text-bad" : ok ? "text-good" : ""}`}>{value}</p>
    </div>
  );
}
