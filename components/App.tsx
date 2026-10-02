"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
const TAB_IDS = ["home", "teacher", "practice", "grade", "ask"] as const;
type TabId = (typeof TAB_IDS)[number];
const isTab = (v: string): v is TabId => (TAB_IDS as readonly string[]).includes(v);

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function App({ kb, results }: { kb: KbData; results: Record<string, GradeResult> }) {
  // The URL hash is the current tab (#practice, #grade…), so a screen can be
  // linked to directly and the back button moves between tabs.
  const hash = useSyncExternalStore(subscribeHash, () => location.hash.slice(1), () => "");
  const tab: TabId = isTab(hash) ? hash : "home";
  const setTab = (t: TabId) => {
    location.hash = t === "home" ? "" : t;
    window.scrollTo({ top: 0 });
  };
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
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-5">
          <button onClick={() => setTab("home")} className="text-left">
            <span className="font-serif text-2xl font-bold tracking-tight">
              intellect<span className="text-red-pen">.</span>
            </span>
            <span className="ml-2 text-sm text-muted">
              {kb.course.code} {kb.course.title} · {kb.course.college}
            </span>
          </button>
          <div className="flex items-center gap-4 text-sm">
            <button onClick={() => setTab("ask")} className={tab === "ask" ? "font-medium text-accent" : "text-muted hover:text-ink"}>
              Ask the course
            </button>
            <span className="text-xs text-muted">Today {kb.course.today}</span>
          </div>
        </header>

        <Chain
          tab={tab}
          setTab={setTab}
          faculty={kb.course.faculty}
          lessonsLogged={plan.plan?.lessonIds.length}
          newLesson={plan.changes ? plan.trigger?.title : undefined}
          exam={plan.plan && { name: plan.plan.assessment.id, daysLeft: plan.plan.daysLeft, taught: plan.plan.coverage.filter((c) => c.status === "taught").length, topics: plan.plan.coverage.length }}
          examUpdated={Boolean(plan.changes)}
          lastCheck={attempts.at(-1)?.result}
        />

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
            <Ask course={kb.course} pyqs={kb.pyqs} rubrics={kb.rubrics} />
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

/**
 * The navigation is the product's chain: what was taught feeds what can be in
 * the exam, which feeds where an answer loses marks. Each step shows a live
 * fact, and a newly logged class lights up the steps it changed.
 */
function Chain({
  tab,
  setTab,
  faculty,
  lessonsLogged,
  newLesson,
  exam,
  examUpdated,
  lastCheck,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  faculty: string;
  lessonsLogged?: number;
  newLesson?: string;
  exam: { name: string; daysLeft: number; taught: number; topics: number } | null;
  examUpdated: boolean;
  lastCheck?: GradeResult;
}) {
  const steps: { id: TabId; n: string; title: string; fact: string; fresh?: boolean }[] = [
    {
      id: "teacher",
      n: "1",
      title: "What was taught",
      fact: newLesson ? `New: ${newLesson}` : `${faculty}'s lesson log${lessonsLogged ? ` · ${lessonsLogged} classes for the exam` : ""}`,
      fresh: Boolean(newLesson),
    },
    {
      id: "practice",
      n: "2",
      title: "What's in my exam?",
      fact: exam ? `${exam.name} in ${exam.daysLeft} days · ${exam.taught} of ${exam.topics} topics taught` : "Study plan and practice paper",
      fresh: examUpdated,
    },
    {
      id: "grade",
      n: "3",
      title: "Where will I lose marks?",
      fact: lastCheck ? `Last check: ${lastCheck.score}/${lastCheck.outOf}, band ${lastCheck.grade}` : "Check an answer against the rubric",
    },
  ];
  return (
    <nav className="sticky top-0 z-10 -mx-4 mb-6 mt-4 border-y border-line bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <ol className="flex items-stretch gap-0 overflow-x-auto">
        {steps.map((s, i) => {
          const active = tab === s.id;
          return (
            <li key={s.id} className="flex min-w-[210px] flex-1 items-center">
              <button
                onClick={() => setTab(s.id)}
                className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition ${active ? "bg-panel shadow-sm ring-1 ring-line" : "hover:bg-panel/60"}`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-serif text-sm font-bold ${
                    active ? "bg-accent text-white dark:text-[#15171b]" : s.fresh ? "ping bg-accent-soft text-accent" : "border border-ink/30 text-muted"
                  }`}
                >
                  {s.n}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm ${active ? "font-semibold" : "font-medium"}`}>{s.title}</span>
                  <span className={`block truncate text-xs ${s.fresh ? "font-medium text-accent" : "text-muted"}`}>{s.fact}</span>
                </span>
              </button>
              {i < steps.length - 1 && (
                <span aria-hidden className="mx-1 flex shrink-0 items-center text-muted">
                  <span className={`h-px w-5 ${steps[i + 1].fresh ? "bg-accent" : "bg-ink/25"}`} />
                  <span className={steps[i + 1].fresh ? "text-accent" : ""}>›</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
