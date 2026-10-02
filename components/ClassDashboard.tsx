"use client";

import { useCallback, useEffect, useState } from "react";
import type { Calibration, CalibrationStats } from "@/lib/types";
import { feedbackReport, MINUTES_PER_REPORT, PASS_PERCENT, type ClassRun } from "./classRun";
import type { GradeResult } from "./Grade";
import { Button, CiteList, Label, Panel, postJson, Thinking } from "./ui";

export function RiskBadge({ percent }: { percent: number }) {
  return percent < PASS_PERCENT ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-xs font-medium text-bad">▲ At risk</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">✓ On track</span>
  );
}

export function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Class-wide average per rubric criterion. Hover a bar for who lost marks there. */
export function GapBars({ criteria }: { criteria: { id: string; name: string; percent: number; losers: { name: string; issue: string; lost: number }[] }[] }) {
  const weakest = Math.min(...criteria.map((c) => c.percent));
  return (
    <div className="space-y-2.5">
      {criteria.map((c) => (
        <div key={c.id} className="group relative">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className={c.percent === weakest ? "font-medium" : ""}>
              {c.name}
              {c.percent === weakest && <span className="ml-2 text-xs text-bad">weakest</span>}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted">{c.percent}%</span>
          </div>
          <div className="h-2 rounded bg-sunken">
            <div className="h-2 rounded bg-accent" style={{ width: `${Math.max(c.percent, 2)}%` }} />
          </div>
          {c.losers.length > 0 && (
            <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-full max-w-md rounded-lg border border-line bg-panel p-3 text-xs shadow-lg group-hover:block">
              <p className="mb-1 font-medium">
                {c.losers.length} student{c.losers.length > 1 ? "s" : ""} lost marks on {c.name.toLowerCase()}
              </p>
              <ul className="space-y-1 text-muted">
                {c.losers.map((l) => (
                  <li key={l.name}>
                    <span className="text-ink">{l.name}</span> (−{l.lost}): {l.issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SaveStory({ name, before, after }: { name: string; before: GradeResult; after: GradeResult }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-center">
          <p className="text-xs text-bad">First draft</p>
          <p className="text-xl font-semibold tabular-nums text-bad">
            {before.score}/{before.outOf}
          </p>
          <p className="text-xs text-bad">Band {before.grade}</p>
        </div>
        <span className="text-muted">→</span>
        <div className="rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-center">
          <p className="text-xs text-good">After feedback</p>
          <p className="text-xl font-semibold tabular-nums text-good">
            {after.score}/{after.outOf}
          </p>
          <p className="text-xs text-good">Band {after.grade}</p>
        </div>
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{name}</span> would have failed this question. The feedback pointed at the exact mark-losing steps before the paper was handed in.
        </p>
      </div>
      {before.nextSteps.length > 0 && (
        <ol className="mt-3 space-y-1.5 text-sm">
          {before.nextSteps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono text-accent">{i + 1}</span>
              <span>
                {s.action} <CiteList ids={s.sourceIds} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The teacher's real mark after valuation, fed back as calibration. */
function ActualMark({
  student,
  questionId,
  result,
  recorded,
  onSaved,
}: {
  student: string;
  questionId: string;
  result: GradeResult;
  recorded?: Calibration;
  onSaved: () => void;
}) {
  const [actual, setActual] = useState(recorded ? String(recorded.actual) : "");
  const [note, setNote] = useState(recorded?.note ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>(recorded ? "saved" : "idle");

  async function save() {
    setState("saving");
    try {
      await postJson("/api/calibration", {
        student,
        questionId,
        rubricId: result.rubric.id,
        predicted: result.score,
        actual: Number(actual),
        outOf: result.outOf,
        note,
      });
      setState("saved");
      onSaved();
    } catch (err) {
      setState(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs font-medium">Mark you actually gave</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          max={result.outOf}
          step={0.5}
          value={actual}
          onChange={(e) => {
            setActual(e.target.value);
            setState("idle");
          }}
          className="w-16 rounded border border-line bg-panel px-2 py-1 text-sm"
        />
        <span className="text-sm text-muted">/ {result.outOf}</span>
        <input
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setState("idle");
          }}
          placeholder="Why it differs (optional) - e.g. 'I accept a linear DT diagram if iteration is written'"
          className="min-w-0 flex-1 rounded border border-line bg-panel px-2 py-1 text-sm"
        />
        <button onClick={save} disabled={actual === "" || state === "saving"} className="text-sm text-accent hover:underline disabled:opacity-50">
          {state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      {state === "saved" && <p className="mt-1 text-xs text-good">Saved. Future grading on this rubric will take your marking into account.</p>}
      {!["idle", "saving", "saved"].includes(state) && <p className="mt-1 text-xs text-bad">{state}</p>}
    </div>
  );
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function ClassDashboard({ classRun, questionTitle }: { classRun: ClassRun; questionTitle: string }) {
  const { status, total, rows, summary, elapsedMs, run } = classRun;
  const [minutesPerReport, setMinutesPerReport] = useState(MINUTES_PER_REPORT);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [accuracy, setAccuracy] = useState<CalibrationStats | null>(null);
  const done = rows.filter((r) => r.result || r.error).length;

  const loadCalibration = useCallback(
    () =>
      fetch("/api/calibration")
        .then((r) => r.json())
        .then((data: { calibrations: Calibration[]; stats: CalibrationStats | null }) => {
          setCalibrations(data.calibrations);
          setAccuracy(data.stats);
        }),
    [],
  );
  useEffect(() => {
    loadCalibration();
  }, [loadCalibration]);

  const allCached = rows.length > 0 && rows.every((r) => r.result?.cached);

  const reportsFor = () =>
    rows
      .filter((r) => r.result)
      .map((r) => feedbackReport(r.draft.student, r.result!))
      .join("\n\n" + "=".repeat(60) + "\n\n");

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Label>Class dashboard</Label>
            <p className="text-lg font-semibold">Feedback reports and gap trends for {questionTitle}</p>
            <p className="mt-1 text-sm text-muted">
              Grades every submission against the college rubric, writes a criterion-level report for each student, and flags who is at risk of failing.
            </p>
          </div>
          <Button onClick={run} disabled={status === "running"}>
            {status === "running" ? `Grading… ${done}/${total}` : status === "done" ? "Re-run" : `Grade all ${total} submissions`}
          </Button>
        </div>
        {status === "running" && (
          <div className="mt-3">
            <Thinking label="Grading in parallel - each student gets their own report" />
          </div>
        )}
      </Panel>

      {summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Class average" value={`${summary.averagePercent}%`} sub={`${summary.graded.length} submissions`} />
            <Tile
              label="At risk of failing"
              value={`${summary.atRisk.length} of ${summary.graded.length}`}
              sub={summary.atRisk.length ? summary.atRisk.map((a) => a.draft.name).join(", ") : "Nobody below the pass line"}
              tone={summary.atRisk.length ? "bad" : "good"}
            />
            <Tile label="Weakest criterion" value={summary.weakest ? `${summary.weakest.percent}%` : "-"} sub={summary.weakest?.name} />
            <div className="rounded-xl border border-line bg-panel px-4 py-3">
              <p className="text-xs text-muted">
                Teacher time saved at{" "}
                <input
                  type="number"
                  min={1}
                  value={minutesPerReport}
                  onChange={(e) => setMinutesPerReport(Math.max(1, Number(e.target.value) || 1))}
                  className="w-10 rounded border border-line bg-panel px-1 text-center"
                />{" "}
                min/report
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-good">{summary.reportsWritten * minutesPerReport} min</p>
              <p className="mt-0.5 text-xs text-muted">
                {summary.reportsWritten} reports in {allCached ? "under a second (cached)" : `${Math.round(elapsedMs / 1000)} s`} · {minutesPerReport} h for a class of 60
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <Label>Class gap trends: average marks per rubric criterion</Label>
              <GapBars criteria={summary.criteria} />
              <p className="mt-3 text-xs text-muted">Hover a bar to see who lost marks there and why. Re-teach the weakest criterion first.</p>
            </Panel>
            <Panel>
              <Label>Saved from failing</Label>
              {summary.saves.length ? (
                summary.saves.map((s) => <SaveStory key={s.name} {...s} />)
              ) : summary.atRisk.length ? (
                <p className="text-sm text-muted">
                  {summary.atRisk.map((a) => a.draft.name).join(", ")} {summary.atRisk.length > 1 ? "are" : "is"} below the pass line. Their reports list the
                  exact steps to fix before the exam.
                </p>
              ) : (
                <p className="text-sm text-muted">No student is below the pass line on this question.</p>
              )}
            </Panel>
          </div>
        </>
      )}

      {rows.length > 0 && (
        <Panel>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label>Students and feedback reports</Label>
              <p className="-mt-1 text-xs text-muted">
                {accuracy
                  ? `Prediction accuracy: off by ${accuracy.meanErrorPercent}% of the marks on average across ${accuracy.count} paper${accuracy.count > 1 ? "s" : ""} you marked; ${accuracy.withinTenPercent}% within one mark in ten. Your corrections are used in future grading.`
                  : "After valuation, enter the mark you actually gave (open a report). That measures prediction accuracy and teaches the grader your standards."}
              </p>
            </div>
            {summary && (
              <button onClick={() => download("feedback-reports.txt", reportsFor())} className="text-sm text-accent hover:underline">
                Download all reports
              </button>
            )}
          </div>
          <div className="divide-y divide-line">
            {rows.map(({ draft, result, error }) => {
              const worst = result?.criteria.filter((c) => c.awarded < c.max).sort((a, b) => b.max - b.awarded - (a.max - a.awarded))[0];
              const isOpen = open === draft.id;
              const recorded = calibrations.find((c) => c.student === draft.student && c.questionId === draft.questionId);
              return (
                <div key={draft.id} className="py-2.5">
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                    <span className="w-44 shrink-0 text-sm font-medium">{draft.student}</span>
                    {result ? (
                      <>
                        <span className="w-14 font-mono text-sm tabular-nums" title={`Likely range ${result.range.low}-${result.range.high}`}>
                          {result.score}/{result.outOf}
                        </span>
                        {recorded && (
                          <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-xs tabular-nums" title={recorded.note || undefined}>
                            teacher {recorded.actual} ({recorded.actual - recorded.predicted >= 0 ? "+" : ""}
                            {recorded.actual - recorded.predicted})
                          </span>
                        )}
                        <span className="w-24 shrink-0">
                          <RiskBadge percent={result.percent} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-muted" title={worst?.issue}>
                          {worst ? `${worst.name}: ${worst.issue}` : "Full marks"}
                        </span>
                        <button onClick={() => setOpen(isOpen ? null : draft.id)} className="shrink-0 text-sm text-accent hover:underline">
                          {isOpen ? "Hide report" : "Report"}
                        </button>
                      </>
                    ) : error ? (
                      <span className="text-sm text-bad">{error}</span>
                    ) : (
                      <Thinking label="Grading" />
                    )}
                  </div>
                  {isOpen && result && (
                    <div className="mt-2 rounded-lg bg-sunken p-3">
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{feedbackReport(draft.student, result)}</pre>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(feedbackReport(draft.student, result));
                          setCopied(draft.id);
                        }}
                        className="mt-2 text-xs text-accent hover:underline"
                      >
                        {copied === draft.id ? "Copied" : "Copy report"}
                      </button>
                      <ActualMark
                        key={recorded?.id ?? "new"}
                        student={draft.student}
                        questionId={draft.questionId}
                        result={result}
                        recorded={recorded}
                        onSaved={loadCalibration}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
