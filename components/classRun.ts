"use client";

import { useCallback, useMemo, useState } from "react";
import type { Draft } from "@/lib/types";
import { gradeDraft, type GradeResult } from "./Grade";

// Below this percentage a student lands in the college's RA (re-appear) band.
export const PASS_PERCENT = 50;

// Default estimate of how long a teacher spends writing one feedback report by hand.
export const MINUTES_PER_REPORT = 8;

export interface ClassRow {
  draft: Draft;
  result?: GradeResult;
  error?: string;
}

export interface ClassRun {
  status: "idle" | "running" | "done";
  total: number;
  rows: ClassRow[];
  elapsedMs: number;
  run: () => Promise<void>;
  summary: ClassSummary | null;
}

export interface ClassSummary {
  graded: { draft: Draft; result: GradeResult }[];
  averagePercent: number;
  atRisk: { draft: Draft; result: GradeResult }[];
  criteria: { id: string; name: string; percent: number; losers: { name: string; issue: string; lost: number }[] }[];
  weakest: { id: string; name: string; percent: number } | null;
  saves: { name: string; before: GradeResult; after: GradeResult }[];
  reportsWritten: number;
}

/** Grades every submission (and any resubmissions) for the class in parallel. */
export function useClassRun(drafts: Draft[]): ClassRun {
  const [status, setStatus] = useState<ClassRun["status"]>("idle");
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);

  const run = useCallback(async () => {
    setStatus("running");
    setRows(drafts.map((draft) => ({ draft })));
    const started = Date.now();
    await Promise.all(
      drafts.map(async (draft, i) => {
        try {
          const result = await gradeDraft({ questionId: draft.questionId, draft: draft.text });
          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, result } : r)));
        } catch (err) {
          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, error: err instanceof Error ? err.message : String(err) } : r)));
        }
      }),
    );
    setElapsedMs(Date.now() - started);
    setStatus("done");
  }, [drafts]);

  const summary = useMemo(() => summarize(rows), [rows]);
  return { status, total: drafts.length, rows, elapsedMs, run, summary };
}

function summarize(rows: ClassRow[]): ClassSummary | null {
  const all = rows.filter((r): r is { draft: Draft; result: GradeResult } => Boolean(r.result));
  const graded = all.filter((r) => !r.draft.resubmissionOf);
  if (!graded.length) return null;

  const criteria = graded[0].result.criteria.map((c) => {
    const scores = graded.map((g) => g.result.criteria.find((x) => x.id === c.id));
    const percent = Math.round((scores.reduce((s, x) => s + (x ? x.awarded / x.max : 0), 0) / graded.length) * 100);
    const losers = graded
      .map((g) => ({ g, x: g.result.criteria.find((x) => x.id === c.id) }))
      .filter(({ x }) => x && x.awarded < x.max)
      .map(({ g, x }) => ({ name: g.draft.name, issue: x!.issue, lost: x!.max - x!.awarded }));
    return { id: c.id, name: c.name, percent, losers };
  });
  const weakest = [...criteria].sort((a, b) => a.percent - b.percent)[0] ?? null;

  const atRisk = graded.filter((g) => g.result.percent < PASS_PERCENT);
  const saves = atRisk.flatMap((before) => {
    const after = all.find((r) => r.draft.resubmissionOf === before.draft.id);
    return after ? [{ name: before.draft.name, before: before.result, after: after.result }] : [];
  });

  return {
    graded,
    averagePercent: Math.round(graded.reduce((s, g) => s + g.result.percent, 0) / graded.length),
    atRisk,
    criteria,
    weakest: weakest && { id: weakest.id, name: weakest.name, percent: weakest.percent },
    saves,
    reportsWritten: all.length,
  };
}

/** Plain-text feedback report a teacher can hand back or file. */
export function feedbackReport(name: string, r: GradeResult) {
  const lines = [
    `Feedback report: ${name}`,
    `Question: ${r.question.text}`,
    `Predicted marks: ${r.score}/${r.outOf} (${r.percent}%, band ${r.grade})${
      r.range.low !== r.range.high ? `, likely range ${r.range.low}-${r.range.high}` : ""
    } - rubric ${r.rubric.id}. A prediction, not an official mark.`,
    "",
    r.summary,
    "",
    "Marks by criterion:",
    ...r.criteria.map(
      (c) =>
        `- ${c.name}: ${c.awarded}/${c.max}${c.issue && c.awarded < c.max ? ` - lost: ${c.issue}` : ""}${c.fix && c.awarded < c.max ? ` Fix: ${c.fix}` : ""}`,
    ),
  ];
  if (r.nextSteps.length) {
    lines.push("", "Do this next:", ...r.nextSteps.map((s, i) => `${i + 1}. ${s.action} (${s.why})`));
  }
  if (r.cannotVerify.length) lines.push("", "Check by hand:", ...r.cannotVerify.map((s) => `- ${s}`));
  return lines.join("\n");
}
