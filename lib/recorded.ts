// Recorded results shipped in data/recorded/. Entries with origin "recorded"
// are real grader and planner outputs captured by scripts/record.mjs; entries
// with origin "authored" are hand-written stand-ins in the same shape, shown
// as samples until a real recording replaces them. They serve two purposes:
//  1. A read-only cache seed. When the request's context key matches the
//     recording exactly, the recorded result is the same answer a live call
//     would return, so it comes back instantly.
//  2. A fallback. If a live call fails (no key, rate limit, network), a sample
//     draft or the demo plan still gets its recorded result, clearly labelled.

import gradesJson from "@/data/recorded/grades.json";
import plansJson from "@/data/recorded/plans.json";

export type Origin = "recorded" | "authored";

/** What a response carries when it came from data/recorded/ rather than a live call. */
export interface RecordedMeta {
  at: string;
  origin: Origin;
  /** Set when a live call was attempted and failed. */
  liveError?: string;
  /** Set when the recording was made against a different lesson log. */
  stale?: boolean;
}

export const meta = (r: { recordedAt: string; origin?: Origin }, extra: Partial<RecordedMeta> = {}): RecordedMeta => ({
  at: r.recordedAt,
  origin: r.origin ?? "recorded",
  ...extra,
});

export interface RecordedGrade {
  draftId: string;
  key: string;
  recordedAt: string;
  origin?: Origin;
  result: Record<string, unknown>;
}

export interface RecordedPlan {
  name: string;
  key: string;
  assessmentId: string;
  lessonIds: string[];
  recordedAt: string;
  origin?: Origin;
  result: Record<string, unknown>;
}

const grades = gradesJson as unknown as RecordedGrade[];
const plans = plansJson as unknown as RecordedPlan[];

export const recordedGradeByKey = (key: string) => grades.find((g) => g.key === key);
export const recordedGradeByDraft = (draftId: string) => grades.find((g) => g.draftId === draftId);

export const recordedPlanByKey = (key: string) => plans.find((p) => p.key === key);

/** Closest recorded plan for an exam: same lesson set if there is one, else the most overlapping. */
export function recordedPlanFallback(assessmentId: string, lessonIds: string[]) {
  const wanted = new Set(lessonIds);
  const score = (p: RecordedPlan) => p.lessonIds.filter((id) => wanted.has(id)).length - Math.abs(p.lessonIds.length - lessonIds.length);
  return plans.filter((p) => p.assessmentId === assessmentId).sort((a, b) => score(b) - score(a))[0];
}

/** Recorded grades for the home-page story, keyed by draft id. Loaded at build time. */
export function recordedResults(draftIds: string[]) {
  return Object.fromEntries(
    draftIds.flatMap((id) => {
      const g = recordedGradeByDraft(id);
      return g ? [[id, { ...g.result, recorded: meta(g) }]] : [];
    }),
  );
}
