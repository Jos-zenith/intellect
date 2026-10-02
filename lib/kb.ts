// Server-side knowledge base: loads the course data, keeps the lesson log
// (seed + teacher additions), and runs BM25 retrieval over every source.

import { promises as fs } from "fs";
import path from "path";
import courseJson from "@/data/course.json";
import seedLessonsJson from "@/data/lessons.json";
import pyqJson from "@/data/pyq.json";
import rubricsJson from "@/data/rubrics.json";
import notesJson from "@/data/notes.json";
import draftsJson from "@/data/drafts.json";
import type {
  Assessment,
  AssessmentId,
  Calibration,
  CalibrationStats,
  Course,
  Draft,
  Lesson,
  Note,
  Pyq,
  Rubric,
  Source,
  SourceType,
  UnitId,
} from "./types";

export const course = courseJson as Course;
export const pyqs = pyqJson as Pyq[];
export const rubrics = rubricsJson as Rubric[];
export const notes = notesJson as Note[];
export const drafts = draftsJson as Draft[];
const seedLessons = seedLessonsJson as Lesson[];

const topicName = new Map(course.units.flatMap((u) => u.topics.map((t) => [t.id, t.name] as const)));
export const unitOfTopic = (topicId: string) => topicId.split(".")[0] as UnitId;
export const topicLabel = (topicId: string) => `${topicId} ${topicName.get(topicId) ?? ""}`.trim();
export const isTopicId = (id: string) => topicName.has(id);

export function getAssessment(id: AssessmentId): Assessment {
  const a = course.assessments.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown assessment ${id}`);
  return a;
}

export const getRubric = (id: string) => rubrics.find((r) => r.id === id);
export const getPyq = (id: string) => pyqs.find((q) => q.id === id);

// ---------------------------------------------------------------------------
// Lesson log. Teacher additions persist to .data/ when the filesystem allows
// it, and fall back to process memory otherwise (e.g. read-only hosting).

const STORE = path.join(process.cwd(), ".data", "teacher-lessons.json");
const memory = globalThis as unknown as { __teacherLessons?: Lesson[] };

async function readTeacherLessons(): Promise<Lesson[]> {
  if (memory.__teacherLessons) return memory.__teacherLessons;
  try {
    memory.__teacherLessons = JSON.parse(await fs.readFile(STORE, "utf8")) as Lesson[];
  } catch {
    memory.__teacherLessons = [];
  }
  return memory.__teacherLessons;
}

async function writeTeacherLessons(lessons: Lesson[]) {
  memory.__teacherLessons = lessons;
  try {
    await fs.mkdir(path.dirname(STORE), { recursive: true });
    await fs.writeFile(STORE, JSON.stringify(lessons, null, 2));
  } catch {
    // Read-only filesystem: keep the in-memory copy.
  }
}

export async function getLessons(): Promise<Lesson[]> {
  const all = [...seedLessons, ...(await readTeacherLessons())];
  return all.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export async function addLesson(input: Omit<Lesson, "id" | "addedByTeacher">): Promise<Lesson> {
  const existing = await readTeacherLessons();
  const base = `LES-${input.date.slice(5).replace("-", "")}`;
  const taken = new Set([...seedLessons, ...existing].map((l) => l.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  const lesson: Lesson = { ...input, id, addedByTeacher: true };
  await writeTeacherLessons([...existing, lesson]);
  return lesson;
}

export async function resetTeacherLessons() {
  await writeTeacherLessons([]);
}

// ---------------------------------------------------------------------------
// Calibration: the teacher's actual marks for papers the system predicted.
// They measure prediction accuracy and are fed back into future grading.

const CAL_STORE = path.join(process.cwd(), ".data", "calibration.json");
const calMemory = globalThis as unknown as { __calibration?: Calibration[] };

export async function getCalibrations(): Promise<Calibration[]> {
  if (calMemory.__calibration) return calMemory.__calibration;
  try {
    calMemory.__calibration = JSON.parse(await fs.readFile(CAL_STORE, "utf8")) as Calibration[];
  } catch {
    calMemory.__calibration = [];
  }
  return calMemory.__calibration;
}

async function writeCalibrations(list: Calibration[]) {
  calMemory.__calibration = list;
  try {
    await fs.mkdir(path.dirname(CAL_STORE), { recursive: true });
    await fs.writeFile(CAL_STORE, JSON.stringify(list, null, 2));
  } catch {
    // Read-only filesystem: keep the in-memory copy.
  }
}

export async function addCalibration(input: Omit<Calibration, "id" | "date">): Promise<Calibration> {
  const existing = await getCalibrations();
  // One entry per student per question: a re-entry replaces the earlier mark.
  const rest = existing.filter((c) => !(c.student === input.student && c.questionId === input.questionId && c.rubricId === input.rubricId));
  const entry: Calibration = { ...input, id: `CAL-${String(existing.length + 1).padStart(3, "0")}`, date: course.today };
  while (rest.some((c) => c.id === entry.id)) entry.id = `CAL-${Math.floor(Math.random() * 900 + 100)}`;
  await writeCalibrations([...rest, entry]);
  return entry;
}

export async function resetCalibrations() {
  await writeCalibrations([]);
}

export function calibrationStats(list: Calibration[]): CalibrationStats | null {
  if (!list.length) return null;
  const errors = list.map((c) => ((c.predicted - c.actual) / c.outOf) * 100);
  return {
    count: list.length,
    meanErrorPercent: Math.round((errors.reduce((s, e) => s + Math.abs(e), 0) / list.length) * 10) / 10,
    biasPercent: Math.round((errors.reduce((s, e) => s + e, 0) / list.length) * 10) / 10,
    withinTenPercent: Math.round((errors.filter((e) => Math.abs(e) <= 10).length / list.length) * 100),
  };
}

// ---------------------------------------------------------------------------
// Coverage: which syllabus topics have actually been taught before a date,
// and which of them the faculty has excluded from a given assessment.

export type TopicStatus = "taught" | "excluded" | "not-taught";

export interface TopicCoverage {
  topicId: string;
  name: string;
  unit: UnitId;
  status: TopicStatus;
  lessonIds: string[];
  pyqIds: string[];
  pyqMarks: number;
  reason: string;
}

export async function coverageFor(assessmentId: AssessmentId, asOf: string): Promise<TopicCoverage[]> {
  const assessment = getAssessment(assessmentId);
  const lessons = (await getLessons()).filter((l) => l.date <= asOf);
  return course.units
    .filter((u) => assessment.units.includes(u.id))
    .flatMap((u) =>
      u.topics.map((t) => {
        const taughtIn = lessons.filter((l) => l.topicIds.includes(t.id));
        const excludedBy = taughtIn.find((l) => l.excludeFrom?.includes(assessmentId));
        const related = pyqs.filter((q) => q.topicId === t.id);
        const status: TopicStatus = excludedBy ? "excluded" : taughtIn.length ? "taught" : "not-taught";
        const reason = excludedBy
          ? `Faculty excluded it from ${assessmentId} in ${excludedBy.id}`
          : taughtIn.length
            ? `Taught in ${taughtIn.map((l) => l.id).join(", ")}`
            : `Not taught as of ${asOf}`;
        return {
          topicId: t.id,
          name: t.name,
          unit: u.id,
          status,
          lessonIds: taughtIn.map((l) => l.id),
          pyqIds: related.map((q) => q.id),
          pyqMarks: related.reduce((s, q) => s + q.marks, 0),
          reason,
        };
      }),
    );
}

// ---------------------------------------------------------------------------
// Sources: every retrievable item flattened into one shape with a stable id.

export async function getSources(): Promise<Source[]> {
  const lessons = await getLessons();
  const calibrations = await getCalibrations();
  return [
    ...course.units.map<Source>((u) => ({
      id: `SYL-${u.id}`,
      type: "syllabus",
      unit: u.id,
      topicIds: u.topics.map((t) => t.id),
      title: `Syllabus ${u.id}: ${u.title}`,
      text: `${u.id} ${u.title}. ${u.hours} hours, ${u.endSemMarks} marks in the end-semester exam. Topics: ${u.topics
        .map((t) => `${t.id} ${t.name}`)
        .join("; ")}. Assessed in: ${course.assessments
        .filter((a) => a.units.includes(u.id))
        .map((a) => `${a.id} (${a.date})`)
        .join(", ")}.`,
    })),
    ...lessons.map<Source>((l) => ({
      id: l.id,
      type: "lesson",
      unit: l.unit,
      topicIds: l.topicIds,
      title: `Lesson ${l.date}: ${l.title}`,
      text: `Class on ${l.date} by ${course.faculty} (${l.unit}; topics ${l.topicIds.join(", ")}). ${l.summary} Faculty emphasis: ${l.emphasis}${
        l.excludeFrom?.length ? ` Excluded from: ${l.excludeFrom.join(", ")}.` : ""
      }`,
    })),
    ...pyqs.map<Source>((q) => ({
      id: q.id,
      type: "pyq",
      unit: q.unit,
      topicIds: [q.topicId],
      title: `${q.year} ${q.exam} question (${q.marks} marks)`,
      text: `[${q.year} ${q.exam}, ${q.marks} marks, ${q.unit}, topic ${q.topicId}] ${q.question}${
        q.answerKey ? ` Answer key: ${q.answerKey}` : ""
      }${q.examinerNote ? ` Examiner note: ${q.examinerNote}` : ""}`,
    })),
    ...rubrics.map<Source>((r) => ({
      id: r.id,
      type: "rubric",
      unit: null,
      topicIds: [],
      title: `Rubric: ${r.title}`,
      text: `${r.title}. Applies to: ${r.appliesTo}. Criteria: ${r.criteria
        .map((c) => `${c.id} ${c.name} (${c.max} marks) - ${c.descriptor}`)
        .join(" ")} Deductions: ${r.deductions.join(" ")}`,
    })),
    ...calibrations.map<Source>((c) => ({
      id: c.id,
      type: "calibration",
      unit: c.questionId ? (getPyq(c.questionId)?.unit ?? null) : null,
      topicIds: c.questionId ? [getPyq(c.questionId)?.topicId ?? ""].filter(Boolean) : [],
      title: `Teacher calibration: ${c.student}, ${c.questionId ?? "custom question"}`,
      text: `On ${c.date} ${course.faculty} marked ${c.student}'s answer ${c.actual}/${c.outOf}; the prediction was ${c.predicted}/${c.outOf} (rubric ${c.rubricId}).${
        c.note ? ` Teacher's reason: ${c.note}` : ""
      }`,
    })),
    ...notes.map<Source>((n) => ({
      id: n.id,
      type: "note",
      unit: n.unit,
      topicIds: n.topicIds,
      title: n.title,
      text: n.text,
    })),
  ];
}

export async function getSource(id: string) {
  return (await getSources()).find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// BM25 retrieval. The corpus is small and changes when the teacher logs a
// lesson, so the index is rebuilt per query (well under a millisecond).

const STOPWORDS = new Set(
  "a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who why will with do does did my me we you your our can should".split(
    " ",
  ),
);

// Domain abbreviations students actually type.
const EXPANSIONS: Record<string, string> = {
  ux: "user experience",
  ui: "user interface",
  dt: "design thinking",
  pov: "point view problem statement",
  hmw: "how might we",
  jtbd: "jobs done",
  sus: "system usability scale",
  cta: "call action button",
  ia: "information architecture",
  figma: "prototype high fidelity",
  ia1: "internal assessment",
  ia2: "internal assessment",
  pyq: "previous year question",
};

function stem(w: string) {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9.]+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (!w || STOPWORDS.has(w)) continue;
    out.push(stem(w));
    const exp = EXPANSIONS[w];
    if (exp) out.push(...exp.split(" ").map(stem));
  }
  return out;
}

export interface SearchHit extends Source {
  score: number;
}

export async function search(
  query: string,
  opts: { types?: SourceType[]; unit?: UnitId | null; topicIds?: string[]; k?: number } = {},
): Promise<SearchHit[]> {
  const k1 = 1.4;
  const b = 0.75;
  const docs = (await getSources()).filter(
    (s) =>
      (!opts.types?.length || opts.types.includes(s.type)) &&
      (!opts.unit || s.unit === opts.unit || s.unit === null) &&
      (!opts.topicIds?.length || s.topicIds.some((t) => opts.topicIds!.includes(t))),
  );
  if (!docs.length) return [];

  const tokenized = docs.map((d) => tokenize(`${d.title} ${d.text} ${d.topicIds.join(" ")}`));
  const avgLen = tokenized.reduce((s, t) => s + t.length, 0) / tokenized.length;
  const df = new Map<string, number>();
  for (const toks of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);

  const qTerms = [...new Set(tokenize(query))];
  // Exact id mentions ("LES-0812", "U3.T3") should always surface that item.
  const idMentions = new Set(query.toUpperCase().match(/[A-Z]+-[A-Z0-9-]+|U\d\.T\d/g) ?? []);

  const scored = docs.map((doc, i) => {
    const toks = tokenized[i];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of qTerms) {
      const f = tf.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avgLen)));
    }
    if (idMentions.has(doc.id) || doc.topicIds.some((t) => idMentions.has(t))) score += 10;
    return { ...doc, score };
  });

  return scored
    .filter((d) => d.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, opts.k ?? 6);
}

export function gradeFor(percent: number) {
  return course.gradeBands.find((g) => percent >= g.min)?.grade ?? "-";
}
