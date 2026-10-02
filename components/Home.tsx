"use client";

import { useState } from "react";
import type { Course, Draft, Pyq } from "@/lib/types";
import { AnswerSheet, marks, MarksBox, penNotes } from "./AnswerSheet";
import { MINUTES_PER_REPORT, type ClassSummary } from "./classRun";
import { attemptLabel, gradeDraft, type Attempt, type GradeResult } from "./Grade";
import { Button, CiteList, ErrorNote, Panel, ProvenanceNote, Skeleton } from "./ui";

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
    <div className="flex flex-col gap-10">
      {story ? (
        <StoryView story={story} classSummary={classSummary} course={course} goTo={goTo} openInGrade={openInGrade} />
      ) : (
        <h1 className="font-serif text-3xl font-bold tracking-tight sm:text-4xl">Know where you&apos;ll lose marks before you hand it in.</h1>
      )}
      <QuickPredict pyqs={pyqs} drafts={drafts} attempts={attempts} onGraded={onGraded} openInGrade={openInGrade} />
    </div>
  );
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
  const notes = penNotes(before.draft.text, b);
  const minutes = classSummary ? classSummary.reportsWritten * MINUTES_PER_REPORT : 0;
  const lessonCites = [...new Set(notes.flatMap((n) => n.sourceIds).filter((id) => id.startsWith("LES-")))];

  return (
    <section>
      <p className="text-sm text-muted">
        {student} · 2nd year CSE · practising the {question.year} {question.exam} canteen question
      </p>
      <h1 className="mt-2 max-w-4xl font-serif text-[2rem] font-bold leading-[1.15] tracking-tight sm:text-[2.6rem]">
        {student}&apos;s answer would have scored <span className="text-red-pen">{marks(b.score)} out of {b.outOf}</span>.
      </h1>
      <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-muted">
        That&apos;s the re-appear band. Every reason was already on record: last year&apos;s examiner note, the department&apos;s marking scheme, and what{" "}
        {course.faculty} said in class{lessonCites.length ? " " : ""}
        <CiteList ids={lessonCites} />. Intellect puts them in front of the student before the exam, not after the results.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <AnswerSheet draft={before.draft.text} result={b} heading={`Q. ${question.question} (${question.marks} marks)`} />
          <p className="mt-2 text-xs text-muted">First draft, marked against the college rubric. Red pen = marks lost.</p>
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <h2 className="font-serif text-xl font-semibold">What the examiner&apos;s pen says</h2>
            <ol className="mt-3 space-y-4">
              {notes.map((n) => (
                <li key={n.n} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2 text-sm">
                  <span className="red-pen pt-0.5 text-lg font-bold leading-none">{n.n}</span>
                  <div>
                    <p className="font-medium">
                      {n.criterion} <span className="red-pen ml-1 text-base">−{marks(n.lost)}</span>
                    </p>
                    <p className="mt-0.5 leading-relaxed text-muted">{n.issue}</p>
                    <div className="mt-1">
                      <CiteList ids={n.sourceIds} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="paper rounded-sm p-5">
          <p className="font-serif text-lg font-semibold">
            The same evening, one rewrite: <span className="text-red-pen">{marks(b.score)} → {marks(a.score)}</span>
          </p>
          <p className="mb-3 mt-1 text-sm text-paper-ink/70">
            {student} fixed the lines the pen pointed at: a real user need, the stages applied to the canteen, a loop diagram and a test plan.
          </p>
          <MarksBox
            columns={[
              { label: "1st draft", result: b },
              { label: "Rewrite", result: a },
            ]}
          />
        </div>

        <div className="flex flex-col gap-8">
          {classSummary && (
            <div className="border-l-4 border-accent pl-5">
              <p className="font-serif text-lg font-semibold">And for {course.faculty}, the same night</p>
              <ul className="mt-2 space-y-2 text-[15px] leading-relaxed">
                <li>
                  <span className="font-semibold">{classSummary.reportsWritten} answers</span> marked, each with criterion-level feedback:{" "}
                  <span className="font-semibold">about {minutes} minutes</span> of report writing saved.
                </li>
                <li>
                  <span className="font-semibold text-bad">
                    {classSummary.atRisk.length} student{classSummary.atRisk.length === 1 ? "" : "s"}
                  </span>{" "}
                  below the pass line, flagged while there is still time to help.
                </li>
                {classSummary.weakest && (
                  <li>
                    The class&apos;s weak spot: <span className="font-semibold">{classSummary.weakest.name.toLowerCase()}</span> ({classSummary.weakest.percent}%
                    average). That&apos;s what to re-teach first.
                  </li>
                )}
              </ul>
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-3">
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
          </div>
        </div>
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

  return (
    <Panel className="flex flex-col">
      <h2 className="font-serif text-2xl font-bold tracking-tight">Your turn</h2>
      <p className="mt-1 text-sm text-muted">Pick a past question, write or paste your answer, and see it marked the way the department marks it.</p>
      <select
        value={questionId}
        onChange={(e) => {
          setQuestionId(e.target.value);
          setDraft("");
          setShown(null);
        }}
        className="mt-4 w-full rounded-md border border-line bg-panel px-3 py-2 text-sm"
      >
        {applicationQs.map((q) => (
          <option key={q.id} value={q.id}>
            {q.year} {q.exam} · {q.marks}m · {q.question.slice(0, 80)}…
          </option>
        ))}
      </select>

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="paper rounded-sm">
          <p className="border-b border-line/60 px-5 py-3 font-serif text-[13px] font-semibold text-paper-ink/80">
            Q. {pyq.question} ({pyq.marks} marks)
          </p>
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setShown(null);
            }}
            rows={11}
            placeholder="Write your answer here…"
            className="ruled block w-full resize-y rounded-b-sm bg-transparent pb-8 pl-16 pr-4 pt-0 font-hand text-[16.5px] text-paper-ink outline-none placeholder:text-paper-ink/40"
          />
        </div>
        <div>
          {busy && (
            <div className="paper rounded-sm p-6">
              <p className="red-pen mb-4 text-lg">Marking each criterion…</p>
              <Skeleton lines={7} />
            </div>
          )}
          {error && <ErrorNote message={error} />}
          {shown && !busy && (
            <div>
              <AnswerSheet draft={shown.draft} result={shown.result} maxHeight="22rem" />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-sm">
                  Band <span className="font-semibold">{shown.result.grade}</span>
                  {shown.result.range.low !== shown.result.range.high && (
                    <span className="text-muted">
                      {" "}
                      · likely {marks(shown.result.range.low)}–{marks(shown.result.range.high)}
                    </span>
                  )}
                </span>
                <button onClick={() => openInGrade(questionId, shown.draft)} className="text-sm text-accent hover:underline">
                  Why each mark, and how to fix it →
                </button>
              </div>
              <div className="mt-1">
                <ProvenanceNote of={shown.result} />
              </div>
            </div>
          )}
          {!shown && !busy && !error && (
            <div className="flex h-full flex-col justify-center rounded-sm border border-dashed border-line p-6 text-sm text-muted">
              <p>Your marked answer appears here, with the lines that lose marks underlined in red.</p>
              {samples.length > 0 && (
                <p className="mt-3">
                  No answer handy? Try{" "}
                  {samples.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && (i === samples.length - 1 ? " or " : ", ")}
                      <button onClick={() => setDraft(d.text)} className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid">
                        {d.student}
                      </button>
                    </span>
                  ))}
                  .
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4">
        <Button onClick={predict} disabled={busy || !draft.trim()}>
          {busy ? "Marking…" : "Mark my answer"}
        </Button>
      </div>
    </Panel>
  );
}
