"use client";

import { useEffect, useState } from "react";
import { parseRubricText, rubricTextProblem } from "@/lib/rubricText";
import type { CalibrationStats, Draft, Pyq, Rubric } from "@/lib/types";
import { AnswerSheet, marks, MarksBox } from "./AnswerSheet";
import { Handwriting, type HandwritingMeta } from "./Handwriting";
import { Button, CiteList, ErrorNote, Label, Panel, postJson, ProvenanceNote, Skeleton, type Provenance } from "./ui";

export interface GradeResult extends Provenance {
  question: { id: string | null; text: string; marks: number };
  rubric: {
    id: string;
    title: string;
    source?: string | null;
    criteria?: { id: string; name: string; max: number; descriptor: string }[];
    deductions?: string[];
  };
  relevance?: { verdict: "answers-the-question" | "partly" | "off-topic"; reason: string };
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
  grounding: {
    sourcesProvided: { id: string; title: string }[];
    droppedCitations: number;
    /** Evidence quotes the grader gave, and how many were found word for word in the draft. */
    quotes?: { checked: number; found: number };
  };
  elapsedMs: number;
  handwritten?: boolean;
  calibration?: CalibrationStats | null;
}

export interface GradeRequest {
  questionId?: string;
  questionText?: string;
  rubricId?: string;
  /** A pasted rubric, one "Criterion (marks): descriptor" per line. */
  rubricText?: string;
  draft: string;
  handwriting?: { legibility: string; uncertain: string[] };
  /** Skip stored results and call the model. */
  live?: boolean;
}

export const gradeDraft = (req: GradeRequest) => postJson<GradeResult>("/api/grade", req);

const CUSTOM = "__custom";
const PASTE = "__paste";
const PASTE_EXAMPLE = `Problem framing (2): users and context named, need stated with evidence
Research (3): methods fit the question and findings are synthesised
Design decisions (3): each decision traced to a finding
Testing (2): tasks, metric and one iteration`;

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
  const [rubricText, setRubricText] = useState("");
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

  const pasted = !pyq && customRubric === PASTE ? parseRubricText(rubricText) : null;
  const pasteProblem = pasted && rubricText.trim() ? rubricTextProblem(pasted) : null;

  async function grade(live = false) {
    setBusy(true);
    setError("");
    try {
      const rubric = customRubric === PASTE ? { rubricText } : { rubricId: customRubric };
      const base: GradeRequest = pyq ? { questionId: pyq.id, draft, live } : { questionText: customText, ...rubric, draft, live };
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
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Stays in view while the report scrolls, so neither column runs out into blank space. */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-28 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
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
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed" title={pyq.question}>
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
                <option value={PASTE}>Paste your own rubric…</option>
              </select>
              {customRubric === PASTE && (
                <div>
                  <textarea
                    value={rubricText}
                    onChange={(e) => setRubricText(e.target.value)}
                    rows={5}
                    placeholder={`One criterion per line, with its marks in brackets:\n${PASTE_EXAMPLE}`}
                    className="w-full rounded-lg border border-line bg-panel px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-accent"
                  />
                  <p className={`mt-1 text-xs ${pasteProblem ? "text-bad" : "text-muted"}`}>
                    {!rubricText.trim() ? (
                      <button onClick={() => setRubricText(PASTE_EXAMPLE)} className="text-accent hover:underline">
                        Fill an example
                      </button>
                    ) : (
                      pasteProblem ??
                      `${pasted!.criteria.length} criteria, ${pasted!.total} marks. Each one is scored separately.${
                        pasted!.skipped.length ? ` Ignored ${pasted!.skipped.length} line(s) without marks.` : ""
                      }`
                    )}
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="mb-2 mt-5 border-t border-line pt-4">
            <Label>Your answer</Label>
          </div>
          {samples.length > 0 && (
            <p className="mb-3 text-xs text-muted">
              Try{" "}
              {samples.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && (i === samples.length - 1 ? " or " : ", ")}
                  <button
                    onClick={() => {
                      setDraft(d.text);
                      setHandwriting(null);
                    }}
                    className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                  >
                    {d.student}
                  </button>
                </span>
              ))}
            </p>
          )}
          <div className="paper rounded-sm">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              placeholder="Write your answer here. Describe diagrams in brackets with their labels, e.g. [Wireframe: header with search, 3 menu cards, 'Order' button]"
              className="ruled block w-full resize-y rounded-sm bg-transparent pb-8 pl-16 pr-4 font-hand text-[16.5px] text-paper-ink outline-none placeholder:text-paper-ink/40"
            />
          </div>
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
            <Button onClick={() => grade()} disabled={busy || !draft.trim() || (!pyq && !customText.trim()) || Boolean(pasteProblem) || Boolean(pasted && !rubricText.trim())}>
              {busy ? "Marking…" : "Mark my answer"}
            </Button>
            <span className="text-xs text-muted">Marked criterion by criterion against the rubric, answer key and what was stressed in class</span>
          </div>
        </Panel>

      </div>

      <div className="flex flex-col gap-4">
        {busy && (
          <div className="paper rounded-sm p-6">
            <p className="red-pen mb-5 text-lg">Marking each criterion against the answer key and the lesson log…</p>
            <Skeleton lines={18} />
          </div>
        )}
        {error && <ErrorNote message={error} />}
        {latest && !busy && <GradeReport result={latest} draft={history.at(-1)?.draft} previous={history.at(-2)} onRunLive={() => grade(true)} />}
        {!latest && !busy && !error && (
          <MarkingScheme
            rubric={pyq ? rubrics.find((r) => r.id === pyq.rubricId) : customRubric === PASTE ? undefined : rubrics.find((r) => r.id === customRubric)}
            pasted={pasted && !pasteProblem ? pasted.criteria : undefined}
            marks={pyq?.marks}
            examinerNote={pyq?.examinerNote}
          />
        )}
      </div>
    </div>
  );
}

export function GradeReport({
  result,
  draft,
  previous,
  onRunLive,
}: {
  result: GradeResult;
  /** The graded text; shown marked up in red pen when given. */
  draft?: string;
  /** The attempt before this one on the same question, for a before/after marks box. */
  previous?: Attempt;
  onRunLive?: () => void;
}) {
  const offTopic = result.relevance?.verdict === "off-topic";
  return (
    <>
      {result.relevance && result.relevance.verdict !== "answers-the-question" && (
        <div className={`rounded-xl border px-5 py-3 text-sm ${offTopic ? "border-bad/40 bg-bad-soft" : "border-warn/40 bg-warn-soft"}`}>
          <p className={`font-medium ${offTopic ? "text-bad" : "text-warn"}`}>
            {offTopic ? "This doesn't answer the question, so it scores 0." : "Only part of this answers the question."}
          </p>
          <p className="mt-0.5">{result.relevance.reason}</p>
        </div>
      )}
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Label>Predicted marks</Label>
            <p className="pen-circle red-pen inline-flex h-20 w-28 flex-col items-center justify-center">
              <span className="text-4xl font-bold leading-none">{marks(result.score)}</span>
              <span className="text-sm leading-none">out of {result.outOf}</span>
            </p>
            <p className="mt-1 text-sm text-muted">
              {result.range.low === result.range.high ? (
                "No examiner judgement calls found"
              ) : (
                <>
                  Likely range{" "}
                  <span className="font-medium text-ink tabular-nums">
                    {marks(result.range.low)}–{marks(result.range.high)}
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
              {result.rubric.id} · {result.confidence} certainty{result.handwritten ? " · from handwriting" : ""}
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
        <div className="mt-1.5">
          <ProvenanceNote of={result} onRunLive={onRunLive} />
        </div>
      </Panel>

      {draft && <AnswerSheet draft={draft} result={result} />}

      {previous && (
        <div className="paper rounded-sm p-5">
          <p className="mb-2 font-serif text-lg font-semibold">
            Since your last attempt: <span className="text-red-pen">{marks(previous.result.score)} → {marks(result.score)}</span>
          </p>
          <MarksBox
            columns={[
              { label: previous.label.length > 12 ? "Before" : previous.label, result: previous.result },
              { label: "Now", result },
            ]}
          />
        </div>
      )}

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
                <span className="w-24 text-right text-sm tabular-nums" title={c.low !== c.high ? `A fair examiner could give ${c.low}-${c.high}` : undefined}>
                  {c.low !== c.high && <span className="text-xs text-muted">about </span>}
                  <span className="red-pen text-base">{marks(c.awarded)}</span>
                  <span className="text-muted">/{c.max}</span>
                </span>
              </div>
              {c.evidence && <p className="mt-2 border-l-2 border-line pl-3 font-hand text-[15px] text-muted">&ldquo;{c.evidence}&rdquo;</p>}
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

      <HowMarked result={result} />

      <p className="px-1 text-xs text-muted">
        Grounded in {result.grounding.sourcesProvided.length} sources: <CiteList ids={result.grounding.sourcesProvided.map((s) => s.id)} />
        {result.grounding.droppedCitations > 0 && ` · ${result.grounding.droppedCitations} unsupported citation(s) removed`}
      </p>
    </>
  );
}

/** The answer to "where did this mark come from?", in four checkable steps. */
function HowMarked({ result }: { result: GradeResult }) {
  const q = result.grounding.quotes;
  const rubric = result.rubric;
  return (
    <details className="group rounded-xl border border-line bg-panel px-5 py-4 text-sm">
      <summary className="cursor-pointer list-none font-medium">
        How this mark was made <span className="text-xs font-normal text-muted group-open:hidden">(rubric, evidence checks, accuracy)</span>
      </summary>
      <ol className="mt-3 space-y-3">
        <li>
          <p className="font-medium">1. The rubric: {rubric.title}</p>
          <p className="text-muted">{rubric.source ?? "From the college rubric store."}</p>
          {rubric.criteria && (
            <table className="mt-2 w-full text-left text-xs">
              <tbody className="divide-y divide-line">
                {rubric.criteria.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1 pr-2 font-mono text-muted">{c.id}</td>
                    <td className="py-1 pr-2">{c.name}</td>
                    <td className="py-1 pr-2 tabular-nums">{c.max}</td>
                    <td className="py-1 text-muted">{c.descriptor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rubric.deductions && rubric.deductions.length > 0 && <p className="mt-1 text-xs text-muted">Deductions: {rubric.deductions.join(" ")}</p>}
        </li>
        <li>
          <p className="font-medium">2. Each criterion is marked on its own, with a quote from your answer</p>
          <p className="text-muted">
            {q
              ? `${q.found} of ${q.checked} quotes were found word for word in your draft. A quote that can't be found is thrown out, and its mark is flagged for a human check.`
              : "Every mark must point to a line in your draft."}{" "}
            {result.relevance && "The grader first decides whether the draft answers this question at all; an answer to a different question scores 0."}
          </p>
        </li>
        <li>
          <p className="font-medium">3. The total is added up in code, not by the model</p>
          <p className="text-muted">
            Criterion marks are capped at their maximum, rounded to half marks and summed. The likely range comes from each criterion&apos;s low and high
            marks, and the certainty from how wide that range is.
          </p>
        </li>
        <li>
          <p className="font-medium">4. Checked against the teacher&apos;s real marks</p>
          <p className="text-muted">
            {result.calibration
              ? `${result.calibration.count} marked paper(s) so far: off by ${result.calibration.meanErrorPercent}% of the marks on average, ${result.calibration.withinTenPercent}% within one mark in ten. The teacher's corrections are fed into future grading.`
              : "After valuation, the teacher enters the mark they gave. That measures accuracy and teaches the grader their standards. No papers have been entered yet, so no accuracy is claimed."}
          </p>
        </li>
      </ol>
    </details>
  );
}

/** Before anything is marked: exactly how this question will be marked, so the column is useful, not empty. */
function MarkingScheme({
  rubric,
  pasted,
  marks: questionMarks,
  examinerNote,
}: {
  rubric?: Rubric;
  pasted?: { name: string; max: number; descriptor: string }[];
  marks?: number;
  examinerNote?: string;
}) {
  const criteria = rubric?.criteria ?? pasted ?? [];
  const total = criteria.reduce((s, c) => s + c.max, 0);
  return (
    <div className="paper rounded-sm p-6">
      <p className="font-serif text-xl font-bold">How this answer will be marked</p>
      <p className="mt-1 text-sm text-paper-ink/70">
        {rubric?.source ?? (pasted ? "Your pasted rubric." : "Paste a rubric or pick one to see the scheme.")}
        {questionMarks && total && questionMarks !== total ? ` Scaled from ${total} to ${questionMarks} marks.` : ""}
      </p>
      {criteria.length > 0 && (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-paper-ink/70 text-left">
              <th className="py-1.5 pr-3 font-serif font-semibold">Criterion</th>
              <th className="py-1.5 pr-3 font-serif font-semibold">What earns the marks</th>
              <th className="w-12 py-1.5 text-center font-serif font-semibold">Max</th>
            </tr>
          </thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.name} className="border-b border-line align-top">
                <td className="py-2 pr-3 font-medium">{c.name}</td>
                <td className="py-2 pr-3 text-paper-ink/75">{c.descriptor}</td>
                <td className="red-pen py-1.5 text-center text-lg">{marks(c.max)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-paper-ink/70">
              <td className="py-2 font-serif font-semibold" colSpan={2}>
                Total
              </td>
              <td className="red-pen py-1.5 text-center text-lg font-bold">{marks(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {rubric && rubric.deductions.length > 0 && (
        <div className="mt-5">
          <p className="font-serif font-semibold">Deductions</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-paper-ink/75">
            {rubric.deductions.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {examinerNote && (
        <div className="mt-5 border-l-4 border-red-pen pl-4">
          <p className="font-serif font-semibold">What the examiner wrote last year</p>
          <p className="red-pen mt-1 text-[16px] leading-relaxed">{examinerNote}</p>
        </div>
      )}
      <p className="mt-5 text-sm text-paper-ink/70">
        Every criterion is marked on its own, with a quote from your answer as evidence. Lines that lose marks get underlined in red, with the reason and the
        class where it was taught.
      </p>
    </div>
  );
}
