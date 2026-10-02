"use client";

import { useState, type ReactNode } from "react";
import type { Course, Draft, Pyq } from "@/lib/types";
import { MINUTES_PER_REPORT, type ClassSummary } from "./classRun";
import { RiskBadge } from "./ClassDashboard";
import { attemptLabel, gradeDraft, type Attempt, type GradeResult } from "./Grade";
import { Button, CiteList, ErrorNote, Label, Panel, ProvenanceNote, Thinking } from "./ui";

type Tab = "practice" | "grade" | "teacher";

export interface Story {
  student: string;
  question: Pyq;
  before: { draft: Draft; result: GradeResult };
  after: { draft: Draft; result: GradeResult };
}

export function Home({
  course,
  pyqs,
  drafts,
  story,
  classSummary,
  attempts,
  onGraded,
  goTo,
  openInGrade,
}: {
  course: Course;
  pyqs: Pyq[];
  drafts: Draft[];
  story: Story | null;
  classSummary: ClassSummary | null;
  attempts: Attempt[];
  onGraded: (a: Attempt) => void;
  goTo: (tab: Tab) => void;
  openInGrade: (questionId: string, draft: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {story ? (
        <StoryView story={story} classSummary={classSummary} course={course} goTo={goTo} openInGrade={openInGrade} />
      ) : (
        <div className="py-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Know where you&apos;ll lose marks before you hand it in.</h1>
        </div>
      )}
      <QuickPredict pyqs={pyqs} drafts={drafts} attempts={attempts} onGraded={onGraded} openInGrade={openInGrade} />
    </div>
  );
}

/** Splits the draft into plain text and highlighted mark-losing lines, numbered to match the list. */
function highlight(text: string, quotes: { n: number; quote: string }[]) {
  const spans = quotes
    .map(({ n, quote }) => ({ n, start: text.toLowerCase().indexOf(quote.toLowerCase()), len: quote.length }))
    .filter((s) => s.start >= 0)
    .sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start < at) continue;
    out.push(text.slice(at, s.start));
    out.push(
      <mark key={s.start} className="rounded bg-bad-soft px-0.5 text-bad">
        {text.slice(s.start, s.start + s.len)}
        <sup className="ml-0.5 font-sans font-semibold">{s.n}</sup>
      </mark>,
    );
    at = s.start + s.len;
  }
  out.push(text.slice(at));
  return out;
}

function StoryView({
  story,
  classSummary,
  course,
  goTo,
  openInGrade,
}: {
  story: Story;
  classSummary: ClassSummary | null;
  course: Course;
  goTo: (tab: Tab) => void;
  openInGrade: (questionId: string, draft: string) => void;
}) {
  const { before, after, student, question } = story;
  const b = before.result;
  const a = after.result;
  const losses = b.criteria
    .filter((c) => c.awarded < c.max)
    .sort((x, y) => y.max - y.awarded - (x.max - x.awarded))
    .slice(0, 3)
    .map((c, i) => ({ ...c, n: i + 1 }));
  const failing = b.percent < 50;
  const minutes = classSummary ? classSummary.reportsWritten * MINUTES_PER_REPORT : 0;

  return (
    <section className="rounded-2xl border border-line bg-panel p-5 sm:p-7">
      <p className="text-xs font-medium uppercase tracking-wide text-accent">
        {student} · {course.code} · practising the {question.year} {question.exam} canteen question
      </p>
      <h1 className="mt-2 max-w-3xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
        His answer would have scored {b.score}/{b.outOf}
        {failing ? ", a re-appear" : ""}. He found out before the exam, not after the results.
      </h1>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <Label>His first draft</Label>
            <span className="flex items-center gap-2">
              <span className="font-mono text-lg font-semibold tabular-nums text-bad">
                {b.score}/{b.outOf}
              </span>
              <RiskBadge percent={b.percent} />
            </span>
          </div>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken p-4 font-mono text-[12.5px] leading-relaxed">
            {highlight(before.draft.text, losses.filter((l) => l.evidence).map((l) => ({ n: l.n, quote: l.evidence })))}
          </pre>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <Label>What the grader caught</Label>
            <ol className="space-y-3">
              {losses.map((l) => (
                <li key={l.id} className="flex gap-3 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bad-soft text-xs font-semibold text-bad">{l.n}</span>
                  <div>
                    <p>
                      <span className="font-medium">{l.name}</span>{" "}
                      <span className="font-mono text-xs text-bad">
                        −{l.max - l.awarded} of {l.max}
                      </span>
                      {!l.evidence && <span className="ml-1 text-xs text-muted">(missing from the draft)</span>}
                    </p>
                    <p className="mt-0.5 text-muted">{l.issue}</p>
                    <div className="mt-1">
                      <CiteList ids={l.sourceIds} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-lg border border-good/30 bg-good-soft p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-good">After one rewrite that evening</p>
              <p className="font-mono text-lg font-semibold tabular-nums text-good">
                {b.score} → {a.score}/{a.outOf} · band {a.grade}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {a.criteria.map((c) => {
                const was = b.criteria.find((x) => x.id === c.id)?.awarded ?? 0;
                return (
                  <div key={c.id} title={`${c.name}: ${was} → ${c.awarded} of ${c.max}`}>
                    <div className="relative h-1.5 rounded bg-panel">
                      <div className="absolute h-1.5 rounded bg-good" style={{ width: `${(c.awarded / c.max) * 100}%` }} />
                      <div className="absolute h-1.5 rounded bg-bad" style={{ width: `${(was / c.max) * 100}%` }} />
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted">
                      {c.name.split(" ")[0]} {was}→{c.awarded}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {classSummary && (
        <div className="mt-6 grid gap-3 border-t border-line pt-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <p className="text-sm font-medium">Meanwhile, for {course.faculty}:</p>
          <p className="text-sm text-muted">
            <span className="text-ink">
              {classSummary.reportsWritten} answers marked with criterion-level feedback, about {minutes} minutes of report writing saved.
            </span>{" "}
            {classSummary.atRisk.length} student{classSummary.atRisk.length === 1 ? " is" : "s are"} flagged below the pass line while there is still time to
            help{classSummary.weakest ? `, and the class's weak spot is ${classSummary.weakest.name.toLowerCase()} (${classSummary.weakest.percent}% average)` : ""}.
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={() => goTo("grade")}>Check my own answer</Button>
        <Button variant="ghost" onClick={() => openInGrade(question.id, before.draft.text)}>
          See every mark and its source
        </Button>
        <button onClick={() => goTo("teacher")} className="text-sm text-accent hover:underline">
          Open the class view →
        </button>
      </div>
      <div className="mt-3">
        <ProvenanceNote of={b} />
      </div>
    </section>
  );
}

function QuickPredict({
  pyqs,
  drafts,
  attempts,
  onGraded,
  openInGrade,
}: {
  pyqs: Pyq[];
  drafts: Draft[];
  attempts: Attempt[];
  onGraded: (a: Attempt) => void;
  openInGrade: (questionId: string, draft: string) => void;
}) {
  const applicationQs = pyqs.filter((q) => q.marks >= 10 && q.answerKey);
  const [questionId, setQuestionId] = useState("PYQ-25-IA1-B2");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState<{ draft: string; result: GradeResult } | null>(null);

  const pyq = pyqs.find((q) => q.id === questionId)!;
  const samples = drafts.filter((d) => d.questionId === questionId);
  const previous = attempts.filter((a) => a.key === questionId);

  async function predict() {
    setBusy(true);
    setError("");
    try {
      const result = await gradeDraft({ questionId, draft });
      onGraded({ key: questionId, label: attemptLabel(drafts, draft, previous.length), draft, result });
      setShown({ draft, result });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const result = shown?.result;
  const biggestLoss = result?.criteria.filter((c) => c.awarded < c.max).sort((a, b) => b.max - b.awarded - (a.max - a.awarded))[0];
  const tone = !result ? "" : result.percent >= 70 ? "text-good" : result.percent >= 50 ? "text-warn" : "text-bad";

  return (
    <Panel className="flex flex-col">
      <Label>Your turn · paste an answer and see your marks</Label>
      <select
        value={questionId}
        onChange={(e) => {
          setQuestionId(e.target.value);
          setDraft("");
          setShown(null);
        }}
        className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm"
      >
        {applicationQs.map((q) => (
          <option key={q.id} value={q.id}>
            {q.year} {q.exam} · {q.marks}m · {q.question.slice(0, 80)}…
          </option>
        ))}
      </select>
      <p className="mt-2 line-clamp-3 text-sm text-muted">{pyq.question}</p>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={7}
        placeholder="Drop your draft answer here…"
        className="mt-3 w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-accent"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={predict} disabled={busy || !draft.trim()}>
          {busy ? "Predicting…" : "Predict my marks"}
        </Button>
        {samples.length > 0 && <span className="text-xs text-muted">or try</span>}
        {samples.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              setDraft(d.text);
              setShown(null);
            }}
            className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-accent hover:text-accent"
          >
            {d.student}
          </button>
        ))}
      </div>

      {busy && (
        <div className="mt-4">
          <Thinking label="Checking every rubric criterion against the answer key…" />
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}
      {result && !busy && (
        <div className="mt-4 rounded-lg border border-line bg-sunken p-4">
          <div className="flex flex-wrap items-center gap-4">
            <p className={`text-4xl font-semibold tabular-nums ${tone}`}>
              {result.score}
              <span className="text-xl text-muted">/{result.outOf}</span>
            </p>
            <div className="text-sm">
              <p>
                Band <span className="font-semibold">{result.grade}</span> · {result.percent}%
                {result.range.low !== result.range.high && (
                  <span className="text-muted">
                    {" "}
                    · likely {result.range.low}–{result.range.high}
                  </span>
                )}
              </p>
              <RiskBadge percent={result.percent} />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {result.criteria.map((c) => (
              <div key={c.id} title={`${c.name}: ${c.awarded}/${c.max}`}>
                <div className="h-1.5 rounded bg-panel">
                  <div
                    className={`h-1.5 rounded ${c.awarded === c.max ? "bg-good" : c.awarded === 0 ? "bg-bad" : "bg-warn"}`}
                    style={{ width: `${(c.awarded / c.max) * 100}%` }}
                  />
                </div>
                <p className="mt-1 truncate text-[11px] text-muted">
                  {c.name.split(" ")[0]} {c.awarded}/{c.max}
                </p>
              </div>
            ))}
          </div>
          {biggestLoss && (
            <p className="mt-3 text-sm">
              <span className="font-medium text-bad">Biggest loss ({biggestLoss.name}): </span>
              {biggestLoss.issue}
            </p>
          )}
          {result.relevance?.verdict === "off-topic" && (
            <p className="mt-3 text-sm font-medium text-bad">Doesn&apos;t answer this question: {result.relevance.reason}</p>
          )}
          <button onClick={() => openInGrade(questionId, shown!.draft)} className="mt-2 text-sm text-accent hover:underline">
            Full breakdown with fixes and sources →
          </button>
          <div className="mt-2">
            <ProvenanceNote of={result} />
          </div>
        </div>
      )}
    </Panel>
  );
}
