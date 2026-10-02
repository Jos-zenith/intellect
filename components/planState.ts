"use client";

import { useCallback, useRef, useState } from "react";
import type { Assessment, AssessmentId, Lesson } from "@/lib/types";
import { postJson, type Provenance } from "./ui";

export interface CoverageRow {
  topicId: string;
  name: string;
  status: "taught" | "excluded" | "not-taught";
  lessonIds: string[];
  pyqMarks: number;
  reason: string;
}

export interface PracticeQuestion {
  part: string;
  number: number;
  marks: number;
  topicId: string;
  topicName: string;
  question: string;
  basedOnLessons: string[];
  similarPyqs: string[];
  examinerLooksFor: string;
  problems: string[];
}

export interface PlanResult extends Provenance {
  assessment: Assessment;
  asOf: string;
  daysLeft: number;
  coverage: CoverageRow[];
  lessonIds: string[];
  priorities: { topicId: string; topicName: string; why: string; sourceIds: string[] }[];
  studyPlan: { session: number; focus: string; topicIds: string[]; tasks: string[]; sourceIds: string[] }[];
  practiceTest: PracticeQuestion[];
  check: { questions: number; totalMarks: number; expectedMarks: number; outOfScope: number };
}

/** What a lesson-log change did to the plan: computed in code by comparing two plans. */
export interface PlanChanges {
  newLessons: string[];
  flipped: { topicId: string; name: string; from: CoverageRow["status"] | "absent"; to: CoverageRow["status"] }[];
  sessions: number[];
  questions: string[];
}

export const questionKey = (q: Pick<PracticeQuestion, "part" | "number">) => `${q.part}-${q.number}`;

export function planChanges(prev: PlanResult | null, next: PlanResult | null): PlanChanges | null {
  if (!prev || !next || prev.assessment.id !== next.assessment.id) return null;
  const newLessons = next.lessonIds.filter((id) => !prev.lessonIds.includes(id));
  if (!newLessons.length) return null;
  const before = new Map(prev.coverage.map((c) => [c.topicId, c.status]));
  const touches = (ids: string[]) => ids.some((id) => newLessons.includes(id));
  return {
    newLessons,
    flipped: next.coverage
      .filter((c) => before.get(c.topicId) !== c.status)
      .map((c) => ({ topicId: c.topicId, name: c.name, from: before.get(c.topicId) ?? "absent", to: c.status })),
    sessions: next.studyPlan.filter((s) => touches(s.sourceIds)).map((s) => s.session),
    questions: next.practiceTest.filter((q) => touches(q.basedOnLessons)).map(questionKey),
  };
}

export interface PlanState {
  assessmentId: AssessmentId;
  asOf: string;
  plan: PlanResult | null;
  /** The plan this one replaced, kept to show what a lesson-log change did. */
  previous: PlanResult | null;
  changes: PlanChanges | null;
  /** The lesson whose logging triggered the latest rebuild, if any. */
  trigger: Lesson | null;
  busy: boolean;
  error: string;
  build: (opts?: { assessmentId?: AssessmentId; asOf?: string; live?: boolean; trigger?: Lesson | null }) => Promise<void>;
}

export function usePlan(today: string): PlanState {
  const [assessmentId, setAssessmentId] = useState<AssessmentId>("IA2");
  const [asOf, setAsOf] = useState(today);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [previous, setPrevious] = useState<PlanResult | null>(null);
  const [trigger, setTrigger] = useState<Lesson | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const current = useRef<PlanResult | null>(null);

  const build = useCallback<PlanState["build"]>(
    async (opts = {}) => {
      const id = opts.assessmentId ?? assessmentId;
      const date = opts.asOf ?? asOf;
      setAssessmentId(id);
      setAsOf(date);
      if (opts.trigger !== undefined) setTrigger(opts.trigger);
      const call = ++latest.current;
      setBusy(true);
      setError("");
      try {
        const next = await postJson<PlanResult>("/api/plan", { assessmentId: id, asOf: date, live: opts.live });
        if (call !== latest.current) return;
        const prev = current.current;
        if (prev && prev.lessonIds.join() !== next.lessonIds.join()) setPrevious(prev);
        else if (prev?.assessment.id !== next.assessment.id) setPrevious(null);
        current.current = next;
        setPlan(next);
      } catch (err) {
        if (call === latest.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (call === latest.current) setBusy(false);
      }
    },
    [assessmentId, asOf],
  );

  return { assessmentId, asOf, plan, previous, changes: planChanges(previous, plan), trigger, busy, error, build };
}
