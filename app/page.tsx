"use client";

import { useEffect, useState } from "react";
import { Ask } from "@/components/Ask";
import { useClassRun } from "@/components/classRun";
import { Grade, type Attempt, type GradePreset } from "@/components/Grade";
import { Overview } from "@/components/Overview";
import { Practice } from "@/components/Practice";
import { Teacher } from "@/components/Teacher";
import { ErrorNote, SourceProvider, Thinking } from "@/components/ui";
import type { Course, Draft, Pyq, Rubric } from "@/lib/types";

interface KbData {
  course: Course;
  pyqs: Pyq[];
  rubrics: Rubric[];
  drafts: Draft[];
  hasKey: boolean;
}

const TABS = [
  { id: "overview", label: "Overview", proof: "Student + teacher" },
  { id: "ask", label: "Ask", proof: "Knowledge base depth" },
  { id: "practice", label: "Study plan & test", proof: "Logic continuity" },
  { id: "grade", label: "Predict my grade", proof: "Rubric rigor" },
  { id: "teacher", label: "Teacher", proof: "The ah-ha moment" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const NO_DRAFTS: Draft[] = [];

export default function Home() {
  const [kb, setKb] = useState<KbData | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("overview");
  const [preset, setPreset] = useState<GradePreset | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const classRun = useClassRun(kb?.drafts ?? NO_DRAFTS);

  useEffect(() => {
    fetch("/api/kb")
      .then((r) => r.json())
      .then(setKb)
      .catch(() => setError("Could not load the course knowledge base."));
  }, []);

  const addAttempt = (a: Attempt) => setAttempts((prev) => [...prev, a]);
  const classPyq = kb?.pyqs.find((q) => q.id === kb.drafts[0]?.questionId);
  const classQuestion = classPyq ? `the ${classPyq.year} ${classPyq.exam} ${classPyq.marks}-mark question` : "this question";

  return (
    <SourceProvider>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-10 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line py-5">
          <div>
            <p className="text-xl font-semibold tracking-tight">
              intellect<span className="text-accent">.</span>
              <span className="ml-2 text-sm font-normal text-muted">Study-to-Grade copilot</span>
            </p>
            {kb && (
              <p className="mt-1 text-sm text-muted">
                {kb.course.code} {kb.course.title} · {kb.course.faculty} · {kb.course.college}
              </p>
            )}
          </div>
          {kb && <p className="text-xs text-muted">Today: {kb.course.today}</p>}
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
              <span className={`block text-[11px] ${tab === t.id ? "text-accent" : "text-muted"}`}>{t.proof}</span>
            </button>
          ))}
        </nav>

        {error && <ErrorNote message={error} />}
        {kb && !kb.hasKey && (
          <div className="mb-4">
            <ErrorNote message="No ANTHROPIC_API_KEY found. Create docs/.env.local with ANTHROPIC_API_KEY=sk-ant-... and restart the dev server. Browsing sources works without it." />
          </div>
        )}
        {!kb && !error && <Thinking label="Loading course" />}

        {kb && (
          <main>
            <div hidden={tab !== "overview"}>
              <Overview
                course={kb.course}
                pyqs={kb.pyqs}
                drafts={kb.drafts}
                attempts={attempts}
                onGraded={addAttempt}
                classRun={classRun}
                goTo={setTab}
                openInGrade={(questionId, draft) => {
                  setPreset({ kind: "pyq", questionId, draft, nonce: Date.now() });
                  setTab("grade");
                }}
              />
            </div>
            <div hidden={tab !== "ask"}>
              <Ask course={kb.course} />
            </div>
            <div hidden={tab !== "practice"}>
              <Practice
                course={kb.course}
                onAnswer={(q) => {
                  setPreset({ kind: "custom", ...q, nonce: Date.now() });
                  setTab("grade");
                }}
              />
            </div>
            <div hidden={tab !== "grade"}>
              <Grade pyqs={kb.pyqs} rubrics={kb.rubrics} drafts={kb.drafts} preset={preset} attempts={attempts} onGraded={addAttempt} />
            </div>
            <div hidden={tab !== "teacher"}>
              <Teacher course={kb.course} classRun={classRun} questionTitle={classQuestion} />
            </div>
          </main>
        )}
      </div>
    </SourceProvider>
  );
}
