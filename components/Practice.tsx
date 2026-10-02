"use client";

import { useState } from "react";
import type { Assessment, AssessmentId, Course } from "@/lib/types";
import { Button, CiteList, ErrorNote, Label, Panel, postJson, RichText, Thinking } from "./ui";

interface CoverageRow {
  topicId: string;
  name: string;
  status: "taught" | "excluded" | "not-taught";
  lessonIds: string[];
  pyqMarks: number;
  reason: string;
}

interface PracticeQuestion {
  part: string;
  number: number;
  marks: number;
  topicId: string;
  topicName: string;
  question: string;
  basedOnLessons: string[];
  similarPyqs: string[];
  examinerLooksFor: string;
  problems: string[];
}

interface PlanResult {
  assessment: Assessment;
  asOf: string;
  daysLeft: number;
  coverage: CoverageRow[];
  lessonIds: string[];
  priorities: { topicId: string; topicName: string; why: string; sourceIds: string[] }[];
  studyPlan: { session: number; focus: string; topicIds: string[]; tasks: string[]; sourceIds: string[] }[];
  practiceTest: PracticeQuestion[];
  check: { questions: number; totalMarks: number; expectedMarks: number; outOfScope: number };
  elapsedMs: number;
}

const STATUS_STYLE = {
  taught: "bg-good-soft text-good",
  excluded: "bg-warn-soft text-warn",
  "not-taught": "bg-sunken text-muted",
} as const;

const STATUS_TEXT = { taught: "Taught", excluded: "Excluded", "not-taught": "Not taught yet" } as const;

function storageKey(id: AssessmentId) {
  return `intellect:plan-lessons:${id}`;
}

export function Practice({
  course,
  onAnswer,
}: {
  course: Course;
  onAnswer: (q: { text: string; marks: number }) => void;
}) {
  const [assessmentId, setAssessmentId] = useState<AssessmentId>("IA2");
  const [asOf, setAsOf] = useState(course.today);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [newLessons, setNewLessons] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await postJson<PlanResult>("/api/plan", { assessmentId, asOf });
      let previous: string[] | null = null;
      try {
        previous = JSON.parse(localStorage.getItem(storageKey(assessmentId)) ?? "null");
        localStorage.setItem(storageKey(assessmentId), JSON.stringify(result.lessonIds));
      } catch {
        // Storage unavailable: skip the change banner.
      }
      setNewLessons(previous ? result.lessonIds.filter((id) => !previous!.includes(id)) : null);
      setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const exams = course.assessments.filter((a) => a.date >= course.today);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label>Exam</Label>
            <select
              value={assessmentId}
              onChange={(e) => setAssessmentId(e.target.value as AssessmentId)}
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
            <Label>Taught up to</Label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={generate} disabled={busy}>
            {busy ? "Building…" : plan ? "Regenerate plan and test" : "Build study plan and practice test"}
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">
          Built only from topics in the lesson log. Log a new class in the Teacher tab, regenerate, and the plan and test change to match.
        </p>
      </Panel>

      {busy && (
        <Panel>
          <Thinking label="Reading the lesson log, past papers and exam pattern…" />
        </Panel>
      )}
      {error && <ErrorNote message={error} />}

      {plan && !busy && (
        <>
          {newLessons && newLessons.length > 0 && (
            <div className="rounded-xl border border-accent/40 bg-accent-soft px-5 py-3 text-sm">
              <span className="font-medium text-accent">New since your last plan:</span> <CiteList ids={newLessons} /> The plan and test below now
              include {newLessons.length === 1 ? "this class" : "these classes"}.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="Days to exam" value={String(plan.daysLeft)} />
            <Stat label="Topics in scope" value={`${plan.coverage.filter((c) => c.status === "taught").length}/${plan.coverage.length}`} />
            <Stat label="Paper marks" value={`${plan.check.totalMarks}/${plan.check.expectedMarks}`} ok={plan.check.totalMarks === plan.check.expectedMarks} />
            <Stat label="Out-of-scope questions" value={String(plan.check.outOfScope)} ok={plan.check.outOfScope === 0} />
          </div>

          <Panel>
            <Label>Continuity proof: what can be tested as of {plan.asOf}</Label>
            <div className="divide-y divide-line">
              {plan.coverage.map((c) => (
                <div key={c.topicId} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}>{STATUS_TEXT[c.status]}</span>
                  <span className="font-mono text-xs text-muted">{c.topicId}</span>
                  <span className="flex-1 text-sm">{c.name}</span>
                  <span className="text-xs text-muted">
                    {c.status === "taught" ? <CiteList ids={c.lessonIds} /> : c.reason}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <Label>Priorities, ranked by marks at stake</Label>
              <ol className="space-y-3">
                {plan.priorities.map((p, i) => (
                  <li key={p.topicId} className="flex gap-3">
                    <span className="mt-0.5 font-mono text-sm text-accent">{i + 1}</span>
                    <div className="text-sm">
                      <p className="font-medium">{p.topicName}</p>
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
                  <li key={s.session} className="text-sm">
                    <p className="font-medium">
                      <span className="text-accent">Session {s.session}.</span> {s.focus}
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
              <span className="text-xs text-muted">Generated in {(plan.elapsedMs / 1000).toFixed(0)} s</span>
            </div>
            <div className="space-y-3">
              {plan.practiceTest.map((q) => (
                <div
                  key={`${q.part}-${q.number}`}
                  className={`rounded-lg border p-4 ${q.problems.length ? "border-bad/40 bg-bad-soft" : "border-line"}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-semibold">
                      Part {q.part} · Q{q.number}
                    </span>
                    <span className="rounded bg-sunken px-1.5 py-0.5">{q.marks} marks</span>
                    <span className="text-muted">{q.topicName}</span>
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
                      Answer and get graded →
                    </button>
                  </div>
                  {q.problems.length > 0 && <p className="mt-2 text-xs font-medium text-bad">Scope check failed: {q.problems.join("; ")}</p>}
                </div>
              ))}
            </div>
          </Panel>
        </>
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
