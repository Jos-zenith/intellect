"use client";

import { useState } from "react";
import type { Course, Draft, Pyq } from "@/lib/types";
import { MINUTES_PER_REPORT, type ClassRun } from "./classRun";
import { RiskBadge, SaveStory } from "./ClassDashboard";
import { attemptLabel, gradeDraft, type Attempt, type GradeResult } from "./Grade";
import { Button, ErrorNote, Label, Panel, Thinking } from "./ui";

type Tab = "ask" | "practice" | "grade" | "teacher";

const PROOFS: { tab: Tab; metric: string; claim: string; how: string }[] = [
  {
    tab: "practice",
    metric: "Logic continuity",
    claim: "Monday's class is in Tuesday's plan and Wednesday's test.",
    how: "Coverage comes from the lesson log in code; off-syllabus questions are flagged.",
  },
  {
    tab: "grade",
    metric: "Rubric rigor",
    claim: "A predicted mark for every rubric criterion, before submission.",
    how: "Scored against the college rubric, answer key and examiner notes, with quoted evidence.",
  },
  {
    tab: "ask",
    metric: "Knowledge base depth",
    claim: "Answers grounded in the syllabus, weightage, lesson log and past papers.",
    how: "Every claim carries a clickable source id.",
  },
  {
    tab: "teacher",
    metric: "The ah-ha moment",
    claim: "A class of feedback reports in seconds, and the student it saved.",
    how: "Class gap trends, at-risk flags, downloadable reports.",
  },
];

export function Overview({
  course,
  pyqs,
  drafts,
  attempts,
  onGraded,
  classRun,
  goTo,
  openInGrade,
}: {
  course: Course;
  pyqs: Pyq[];
  drafts: Draft[];
  attempts: Attempt[];
  onGraded: (a: Attempt) => void;
  classRun: ClassRun;
  goTo: (tab: Tab) => void;
  openInGrade: (questionId: string, draft: string) => void;
}) {
  const classPyq = pyqs.find((q) => q.id === drafts[0]?.questionId);
  const classQuestion = classPyq ? `the ${classPyq.year} ${classPyq.exam} ${classPyq.marks}-mark question` : "this question";
  return (
    <div className="flex flex-col gap-4">
      <div className="py-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Teaching, studying and grading on the same page.</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Students see their predicted mark before they hand in. Teachers get every feedback report written and see where the class is slipping. Both are
          built on what {course.faculty} actually taught.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <QuickPredict pyqs={pyqs} drafts={drafts} attempts={attempts} onGraded={onGraded} openInGrade={openInGrade} />
        <TeacherSnapshot classRun={classRun} goTo={goTo} questionTitle={classQuestion} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PROOFS.map((p) => (
          <button
            key={p.metric}
            onClick={() => goTo(p.tab)}
            className="rounded-xl border border-line bg-panel p-4 text-left transition hover:border-accent"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-accent">{p.metric}</p>
            <p className="mt-1.5 text-sm font-medium">{p.claim}</p>
            <p className="mt-1 text-xs text-muted">{p.how}</p>
            <p className="mt-2 text-xs text-accent">See it →</p>
          </button>
        ))}
      </div>
    </div>
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
      <Label>For students · predict my grade before I hand it in</Label>
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
          <button onClick={() => openInGrade(questionId, shown!.draft)} className="mt-2 text-sm text-accent hover:underline">
            Full breakdown with fixes and sources →
          </button>
        </div>
      )}
    </Panel>
  );
}

function TeacherSnapshot({ classRun, goTo, questionTitle }: { classRun: ClassRun; goTo: (tab: Tab) => void; questionTitle: string }) {
  const { status, rows, total, summary, run } = classRun;
  const done = rows.filter((r) => r.result || r.error).length;
  const save = summary?.saves[0];

  return (
    <Panel className="flex flex-col">
      <Label>For teachers · this week&apos;s class at a glance</Label>
      {!summary && (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <p className="text-sm text-muted">
            Grade all {total} submissions for {questionTitle}. Every student gets a criterion-level feedback report, and you get the class gap
            trend and who is at risk of failing.
          </p>
          <div>
            <Button onClick={run} disabled={status === "running"}>
              {status === "running" ? `Grading… ${done}/${total}` : "Grade the class"}
            </Button>
          </div>
          {status === "running" && <Thinking label="Writing one report per student" />}
          {rows.some((r) => r.error) && <ErrorNote message={rows.find((r) => r.error)!.error!} />}
        </div>
      )}
      {summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-sunken px-2 py-2">
              <p className="text-xl font-semibold tabular-nums">{summary.averagePercent}%</p>
              <p className="text-[11px] text-muted">class average</p>
            </div>
            <div className="rounded-lg bg-sunken px-2 py-2">
              <p className={`text-xl font-semibold tabular-nums ${summary.atRisk.length ? "text-bad" : "text-good"}`}>{summary.atRisk.length}</p>
              <p className="text-[11px] text-muted">at risk of failing</p>
            </div>
            <div className="rounded-lg bg-sunken px-2 py-2">
              <p className="text-xl font-semibold tabular-nums text-good">{summary.reportsWritten * MINUTES_PER_REPORT} min</p>
              <p className="text-[11px] text-muted">of report writing saved</p>
            </div>
          </div>
          {summary.weakest && (
            <p className="text-sm">
              <span className="font-medium">Class weak spot:</span> {summary.weakest.name} ({summary.weakest.percent}% average).{" "}
              <span className="text-muted">{summary.criteria.find((c) => c.id === summary.weakest!.id)?.losers.length ?? 0} students lost marks here.</span>
            </p>
          )}
          {save && <SaveStory name={save.name} before={save.before} after={save.after} />}
          <button onClick={() => goTo("teacher")} className="text-sm text-accent hover:underline">
            Open the class dashboard and reports →
          </button>
        </div>
      )}
    </Panel>
  );
}
