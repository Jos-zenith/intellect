"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Course, Draft, Pyq, Rubric } from "@/lib/types";
import { Ask } from "./Ask";
import { summarize, useClassRun } from "./classRun";
import { Grade, type Attempt, type GradePreset, type GradeResult } from "./Grade";
import { Home, type Story } from "./Home";
import { usePlan } from "./planState";
import { Practice } from "./Practice";
import { Teacher } from "./Teacher";
import { SourceProvider } from "./ui";

export interface KbData {
  course: Course;
  pyqs: Pyq[];
  rubrics: Rubric[];
  drafts: Draft[];
}

// Named for what the user is doing, not for how the product is judged.
const TABS = [
  { id: "home", label: "Home", hint: "Start here" },
  { id: "practice", label: "What's in my exam?", hint: "Study plan and practice paper" },
  { id: "grade", label: "Where will I lose marks?", hint: "Check an answer" },
  { id: "ask", label: "Ask the course", hint: "Syllabus, classes, past papers" },
  { id: "teacher", label: "My class", hint: "For the teacher" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App({ kb, results }: { kb: KbData; results: Record<string, GradeResult> }) {
  const [tab, setTab] = useState<TabId>("home");
  const [preset, setPreset] = useState<GradePreset | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const classDrafts = useMemo(() => kb.drafts.filter((d) => !d.probe), [kb.drafts]);
  const classRun = useClassRun(classDrafts);
  const plan = usePlan(kb.course.today);

  // The plan is ready before anyone opens the tab; stored results make this instant.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    plan.build();
  }, [plan]);

  // Shipped with the page, so the story and class numbers need no request.
  const classSummary = useMemo(
    () => summarize(classDrafts.filter((d) => results[d.id]).map((draft) => ({ draft, result: results[draft.id] }))),
    [classDrafts, results],
  );
  const story = useMemo<Story | null>(() => {
    const after = classDrafts.find((d) => d.resubmissionOf && results[d.id] && results[d.resubmissionOf]?.percent < 50);
    const before = after && classDrafts.find((d) => d.id === after.resubmissionOf);
    const question = after && kb.pyqs.find((q) => q.id === after.questionId);
    if (!after || !before || !question) return null;
    return { student: before.name, question, before: { draft: before, result: results[before.id] }, after: { draft: after, result: results[after.id] } };
  }, [classDrafts, results, kb.pyqs]);

  const addAttempt = (a: Attempt) => setAttempts((prev) => [...prev, a]);
  const classPyq = kb.pyqs.find((q) => q.id === classDrafts[0]?.questionId);
  const classQuestion = classPyq ? `the ${classPyq.year} ${classPyq.exam} ${classPyq.marks}-mark question` : "this question";
  const openInGrade = (questionId: string, draft: string) => {
    setPreset({ kind: "pyq", questionId, draft, nonce: Date.now() });
    setTab("grade");
  };

  return (
    <SourceProvider>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-10 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line py-5">
          <div>
            <button onClick={() => setTab("home")} className="text-xl font-semibold tracking-tight">
              intellect<span className="text-accent">.</span>
              <span className="ml-2 text-sm font-normal text-muted">Study-to-Grade copilot</span>
            </button>
            <p className="mt-1 text-sm text-muted">
              {kb.course.code} {kb.course.title} · {kb.course.faculty} · {kb.course.college}
            </p>
          </div>
          <p className="text-xs text-muted">Today: {kb.course.today}</p>
        </header>

        <nav className="sticky top-0 z-10 -mx-4 mb-5 flex gap-1 overflow-x-auto bg-bg px-4 py-3 sm:-mx-6 sm:px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-lg px-3.5 py-2 text-left text-sm transition ${
                tab === t.id ? "bg-panel font-medium shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
              <span className={`block text-[11px] font-normal ${tab === t.id ? "text-accent" : "text-muted"}`}>
                {t.id === "teacher" ? kb.course.faculty : t.hint}
              </span>
            </button>
          ))}
        </nav>

        <main>
          <div hidden={tab !== "home"}>
            <Home
              course={kb.course}
              pyqs={kb.pyqs}
              drafts={kb.drafts}
              story={story}
              classSummary={classSummary}
              attempts={attempts}
              onGraded={addAttempt}
              goTo={setTab}
              openInGrade={openInGrade}
            />
          </div>
          <div hidden={tab !== "practice"}>
            <Practice
              course={kb.course}
              state={plan}
              onAnswer={(q) => {
                setPreset({ kind: "custom", ...q, nonce: Date.now() });
                setTab("grade");
              }}
            />
          </div>
          <div hidden={tab !== "grade"}>
            <Grade pyqs={kb.pyqs} rubrics={kb.rubrics} drafts={kb.drafts} preset={preset} attempts={attempts} onGraded={addAttempt} />
          </div>
          <div hidden={tab !== "ask"}>
            <Ask course={kb.course} />
          </div>
          <div hidden={tab !== "teacher"}>
            <Teacher
              course={kb.course}
              classRun={classRun}
              questionTitle={classQuestion}
              plan={plan}
              goTo={setTab}
              onLessonsChanged={(lesson) =>
                plan.build({ asOf: lesson && lesson.date > plan.asOf ? lesson.date : plan.asOf, trigger: lesson })
              }
            />
          </div>
        </main>
      </div>
    </SourceProvider>
  );
}
