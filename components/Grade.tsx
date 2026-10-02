"use client";

import { useEffect, useState } from "react";
import type { CalibrationStats, Draft, Pyq, Rubric } from "@/lib/types";
import { Handwriting, type HandwritingMeta } from "./Handwriting";
import { Button, CiteList, ErrorNote, Label, Panel, postJson, Thinking } from "./ui";

export interface GradeResult {
  question: { id: string | null; text: string; marks: number };
  rubric: { id: string; title: string };
  score: number;
  /** Lowest and highest total a fair examiner could give. */
  range: { low: number; high: number };
  outOf: number;
  percent: number;
  grade: string;
  criteria: {
    id: string;
    name: string;
    max: number;
    awarded: number;
    low: number;
    high: number;
    evidence: string;
    issue: string;
    fix: string;
    sourceIds: string[];
  }[];
  strengths: string[];
  nextSteps: { action: string; why: string; sourceIds: string[] }[];
  cannotVerify: string[];
  summary: string;
  confidence: "high" | "medium" | "low";
  grounding: { sourcesProvided: { id: string; title: string }[]; droppedCitations: number };
  elapsedMs: number;
  handwritten?: boolean;
  calibration?: CalibrationStats | null;
  cached?: boolean;
}

export interface GradeRequest {
  questionId?: string;
  questionText?: string;
  rubricId?: string;
  draft: string;
  handwriting?: { legibility: string; uncertain: string[] };
}

export const gradeDraft = (req: GradeRequest) => postJson<GradeResult>("/api/grade", req);

const CUSTOM = "__custom";

/** One graded draft. Kept by the page so every tab sees the same history. */
export interface Attempt {
  key: string;
  label: string;
  draft: string;
  result: GradeResult;
}

/** Opens the Grade tab on a question: a practice question, or a graded draft from the overview. */
export type GradePreset = { nonce: number } & (
  | { kind: "custom"; text: string; marks: number }
  | { kind: "pyq"; questionId: string; draft: string }
);

export function attemptLabel(drafts: Draft[], draft: string, previous: number) {
  return drafts.find((d) => d.text === draft)?.student ?? `Attempt ${previous + 1}`;
}

export function Grade({
  pyqs,
  rubrics,
  drafts,
  preset,
  attempts,
  onGraded,
}: {
  pyqs: Pyq[];
  rubrics: Rubric[];
  drafts: Draft[];
  preset: GradePreset | null;
  attempts: Attempt[];
  onGraded: (a: Attempt) => void;
}) {
  const [questionId, setQuestionId] = useState("PYQ-25-IA1-B2");
  const [customText, setCustomText] = useState("");
  const [customRubric, setCustomRubric] = useState("RUB-10M-APP");
  const [draft, setDraft] = useState("");
  const [handwriting, setHandwriting] = useState<HandwritingMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Jump here from the Practice tab or the overview.
  useEffect(() => {
    if (!preset) return;
    if (preset.kind === "custom") {
      setQuestionId(CUSTOM);
      setCustomText(preset.text);
      setCustomRubric(preset.marks <= 2 ? "RUB-2M" : "RUB-10M-APP");
      setDraft("");
    } else {
      setQuestionId(preset.questionId);
      setDraft(preset.draft);
    }
    setHandwriting(null);
  }, [preset]);

  const pyq = pyqs.find((q) => q.id === questionId);
  const questionKey = pyq ? pyq.id : `custom:${customText}`;
  const samples = drafts.filter((d) => d.questionId === questionId);
  const history = attempts.filter((a) => a.key === questionKey);
  const latest = history.at(-1)?.result;

  async function grade() {
    setBusy(true);
    setError("");
    try {
      const base: GradeRequest = pyq ? { questionId: pyq.id, draft } : { questionText: customText, rubricId: customRubric, draft };
      const req: GradeRequest = handwriting ? { ...base, handwriting: { legibility: handwriting.legibility, uncertain: handwriting.uncertain } } : base;
      const result = await gradeDraft(req);
      onGraded({ key: questionKey, label: attemptLabel(drafts, draft, history.length), draft, result });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col gap-4">
        <Panel>
          <Label>Question</Label>
          <select
            value={questionId}
            onChange={(e) => {
              setQuestionId(e.target.value);
              setDraft("");
              setHandwriting(null);
            }}
            className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm"
          >
            <option value={CUSTOM}>Custom question / practice question / project…</option>
            {pyqs.map((q) => (
              <option key={q.id} value={q.id}>
                {q.year} {q.exam} · {q.marks}m · {q.question.slice(0, 70)}…
              </option>
            ))}
          </select>
          {pyq ? (
            <p className="mt-3 text-sm leading-relaxed">
              {pyq.question} <span className="text-muted">({pyq.marks} marks)</span>
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={3}
                placeholder="Type the question or assignment brief"
                className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <select
                value={customRubric}
                onChange={(e) => setCustomRubric(e.target.value)}
                className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm"
              >
                {rubrics.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Panel>

        <Panel>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Label>Your draft</Label>
            {samples.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {samples.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      setDraft(d.text);
                      setHandwriting(null);
                    }}
                    className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-accent hover:text-accent"
                  >
                    {d.student}
                  </button>
                ))}
              </div>
            )}
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={14}
            placeholder="Type or paste your answer. Describe diagrams and wireframes in brackets with their labels, e.g. [Wireframe: header with search, 3 menu cards, 'Order' button…]"
            className="w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-accent"
          />
          <Handwriting
            questionId={pyq?.id}
            questionText={pyq ? undefined : customText}
            meta={handwriting}
            onTranscribed={(transcript, meta) => {
              setDraft(transcript);
              setHandwriting(meta);
            }}
          />
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={grade} disabled={busy || !draft.trim() || (!pyq && !customText.trim())}>
              {busy ? "Grading…" : "Predict my marks"}
            </Button>
            <span className="text-xs text-muted">Graded against the college rubric, answer key and lesson emphasis</span>
          </div>
        </Panel>

        {history.length > 1 && (
          <Panel>
            <Label>Progress on this question</Label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {history.map((a, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span className="text-muted">→</span>}
                  <span className="rounded-lg border border-line px-2.5 py-1">
                    <span className="text-muted">{a.label}:</span>{" "}
                    <span className="font-semibold tabular-nums">
                      {a.result.score}/{a.result.outOf}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </Panel>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {busy && (
          <Panel>
            <Thinking label="Checking each rubric criterion against the answer key and the lesson log…" />
          </Panel>
        )}
        {error && <ErrorNote message={error} />}
        {latest && !busy && <GradeReport result={latest} />}
        {!latest && !busy && !error && (
          <Panel className="text-sm text-muted">
            <p className="font-medium text-ink">Rubric rigor: a mark for every criterion, and the reason behind it.</p>
            <p className="mt-2">
              Try the two sample drafts from Aarav: his first attempt, then his rewrite after reading the feedback. The grader quotes the exact line that lost
              marks, the rule it broke, and the class where the professor warned about it.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

export function GradeReport({ result }: { result: GradeResult }) {
  const tone = result.percent >= 70 ? "text-good" : result.percent >= 50 ? "text-warn" : "text-bad";
  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Label>Predicted marks</Label>
            <p className={`text-5xl font-semibold tabular-nums ${tone}`}>
              {result.score}
              <span className="text-2xl text-muted">/{result.outOf}</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {result.range.low === result.range.high ? (
                "No examiner judgement calls found"
              ) : (
                <>
                  Likely range{" "}
                  <span className="font-medium text-ink tabular-nums">
                    {result.range.low}–{result.range.high}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="text-right text-sm">
            <p>
              Grade band <span className="font-semibold">{result.grade}</span> · {result.percent}%
            </p>
            <p className="text-xs text-muted">
              {result.rubric.id} · {result.confidence} certainty{result.handwritten ? " · from handwriting" : ""} ·{" "}
              {(result.elapsedMs / 1000).toFixed(0)} s
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm">{result.summary}</p>
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
          A prediction to guide revision, not an official mark.{" "}
          {result.calibration
            ? `Checked against ${result.calibration.count} paper${result.calibration.count > 1 ? "s" : ""} the teacher has marked: predictions are off by ${result.calibration.meanErrorPercent}% of the marks on average${
                Math.abs(result.calibration.biasPercent) >= 5 ? ` and tend to run ${result.calibration.biasPercent > 0 ? "high" : "low"}` : ""
              }.`
            : "No teacher-marked papers yet to check its accuracy against."}
        </p>
      </Panel>

      <Panel>
        <Label>Where the marks went</Label>
        <div className="divide-y divide-line">
          {result.criteria.map((c) => (
            <div key={c.id} className="py-3">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-sm font-medium">{c.name}</span>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken">
                  <div
                    className={`h-full rounded-full ${c.awarded === c.max ? "bg-good" : c.awarded === 0 ? "bg-bad" : "bg-warn"}`}
                    style={{ width: `${(c.awarded / c.max) * 100}%` }}
                  />
                </div>
                <span className="w-16 text-right font-mono text-sm tabular-nums" title={c.low !== c.high ? `A fair examiner could give ${c.low}-${c.high}` : undefined}>
                  {c.low !== c.high && <span className="text-xs text-muted">~</span>}
                  {c.awarded}/{c.max}
                </span>
              </div>
              {c.evidence && <p className="mt-2 border-l-2 border-line pl-3 font-mono text-xs text-muted">&ldquo;{c.evidence}&rdquo;</p>}
              {c.issue && (
                <p className="mt-2 text-sm">
                  <span className="font-medium text-bad">Lost: </span>
                  {c.issue}
                </p>
              )}
              {c.fix && c.awarded < c.max && (
                <p className="mt-1 text-sm">
                  <span className="font-medium text-good">Fix: </span>
                  {c.fix}
                </p>
              )}
              {c.sourceIds.length > 0 && (
                <div className="mt-1.5">
                  <CiteList ids={c.sourceIds} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {result.nextSteps.length > 0 && (
        <Panel>
          <Label>Do this next</Label>
          <ol className="space-y-3">
            {result.nextSteps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="font-mono text-accent">{i + 1}</span>
                <div>
                  <p className="font-medium">{s.action}</p>
                  <p className="text-muted">{s.why}</p>
                  <div className="mt-1">
                    <CiteList ids={s.sourceIds} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {(result.strengths.length > 0 || result.cannotVerify.length > 0) && (
        <Panel className="grid gap-4 text-sm sm:grid-cols-2">
          {result.strengths.length > 0 && (
            <div>
              <Label>Done well</Label>
              <ul className="list-disc space-y-1 pl-5">
                {result.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {result.cannotVerify.length > 0 && (
            <div>
              <Label>Needs a human check</Label>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {result.cannotVerify.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      <p className="px-1 text-xs text-muted">
        Grounded in {result.grounding.sourcesProvided.length} sources: <CiteList ids={result.grounding.sourcesProvided.map((s) => s.id)} />
        {result.grounding.droppedCitations > 0 && ` · ${result.grounding.droppedCitations} unsupported citation(s) removed`}
      </p>
    </>
  );
}
