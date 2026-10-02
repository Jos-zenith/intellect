"use client";

import { useCallback, useEffect, useState } from "react";
import demoLesson from "@/data/demo-lesson.json";
import type { AssessmentId, Course, Lesson, UnitId } from "@/lib/types";
import { ClassDashboard } from "./ClassDashboard";
import type { ClassRun } from "./classRun";
import { readImage, type UploadImage } from "./images";
import { questionKey, type PlanState } from "./planState";
import { Button, Cite, CiteList, ErrorNote, Label, Panel, postJson, Skeleton, Thinking } from "./ui";

const empty = (date: string) => ({
  date,
  unit: "U3" as UnitId,
  topicIds: [] as string[],
  title: "",
  summary: "",
  emphasis: "",
  excludeFrom: [] as AssessmentId[],
});

// The same entry scripts/record.mjs records the "after" plan with.
const DEMO_LESSON = { ...demoLesson, unit: demoLesson.unit as UnitId, excludeFrom: demoLesson.excludeFrom as AssessmentId[] };

export function Teacher({
  course,
  classRun,
  questionTitle,
  plan,
  onLessonsChanged,
  goTo,
}: {
  course: Course;
  classRun: ClassRun;
  questionTitle: string;
  plan: PlanState;
  /** Called with the new lesson after it is logged, or null after a reset. */
  onLessonsChanged: (lesson: Lesson | null) => void;
  goTo: (tab: "practice") => void;
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [form, setForm] = useState(() => empty(course.today));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const data = await fetch("/api/lessons").then((r) => r.json());
    setLessons(data.lessons);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const { lesson } = await postJson<{ lesson: Lesson }>("/api/lessons", form);
      setForm(empty(course.today));
      onLessonsChanged(lesson);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    await fetch("/api/lessons", { method: "DELETE" });
    onLessonsChanged(null);
    await load();
  }

  const unit = course.units.find((u) => u.id === form.unit)!;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const input = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent";

  return (
    <div className="flex flex-col gap-4">
      <ClassDashboard classRun={classRun} questionTitle={questionTitle} />

      <div className="mt-2">
        <p className="text-lg font-semibold">Lesson log</p>
        <p className="text-sm text-muted">What you log here is what students are planned, tested and graded on. No re-indexing, no extra step.</p>
      </div>
      <Ripple state={plan} goTo={goTo} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <div className="mb-3 flex items-center justify-between gap-2">
            <Label>Log today&apos;s class</Label>
            <button onClick={() => setForm(DEMO_LESSON)} className="text-xs text-accent hover:underline">
              Fill today&apos;s class (demo)
            </button>
          </div>
          <QuickLog onDraft={(d) => setForm((f) => ({ ...f, ...d }))} />
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={input} />
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value as UnitId, topicIds: [] })}
                className={input}
              >
                {course.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id} · {u.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              {unit.topics.map((t) => (
                <label key={t.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.topicIds.includes(t.id)}
                    onChange={() => setForm({ ...form, topicIds: toggle(form.topicIds, t.id) })}
                    className="mt-1 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="font-mono text-xs text-muted">{t.id}</span> {t.name}
                  </span>
                </label>
              ))}
            </div>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Lesson title" className={input} />
            <textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              rows={3}
              placeholder="What was covered (concepts, methods, examples)"
              className={input}
            />
            <textarea
              value={form.emphasis}
              onChange={(e) => setForm({ ...form, emphasis: e.target.value })}
              rows={2}
              placeholder="What you stressed / how you will mark it"
              className={input}
            />
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-muted">Exclude from:</span>
              {(["IA2", "END"] as AssessmentId[]).map((a) => (
                <label key={a} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={form.excludeFrom.includes(a)}
                    onChange={() => setForm({ ...form, excludeFrom: toggle(form.excludeFrom, a) })}
                    className="accent-[var(--accent)]"
                  />
                  {a}
                </label>
              ))}
            </div>
            {error && <ErrorNote message={error} />}
            <Button onClick={save} disabled={saving || !form.title.trim() || !form.topicIds.length}>
              {saving ? "Saving…" : "Add to lesson log"}
            </Button>
            <p className="text-xs text-muted">Students&apos; study plans and practice tests rebuild as soon as you add it.</p>
          </div>
        </Panel>

        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <Label>Lesson log{lessons && ` (${lessons.length})`}</Label>
            {lessons?.some((l) => l.addedByTeacher) && (
              <button onClick={reset} className="text-xs text-muted hover:text-bad">
                Remove classes added in this demo
              </button>
            )}
          </div>
          {!lessons && <Skeleton lines={6} />}
          <ol className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {[...(lessons ?? [])].reverse().map((l) => (
              <li key={l.id} className={`rounded-lg border px-3 py-2 text-sm ${l.addedByTeacher ? "border-accent/40 bg-accent-soft" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Cite id={l.id} />
                  <span className="text-xs text-muted">
                    {l.date} · {l.topicIds.join(", ")}
                  </span>
                  {l.excludeFrom?.length ? (
                    <span className="rounded bg-warn-soft px-1.5 text-xs text-warn">not in {l.excludeFrom.join(", ")}</span>
                  ) : null}
                </div>
                <p className="mt-1">{l.title}</p>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}

const STATUS_TEXT = { taught: "Taught", excluded: "Excluded", "not-taught": "Not taught yet", absent: "Not in the syllabus" } as const;

/** One logged class rippling through coverage, the study plan and the practice test. */
function Ripple({ state, goTo }: { state: PlanState; goTo: (tab: "practice") => void }) {
  const { trigger, changes, busy, plan, error } = state;
  if (!trigger) return null;
  const pending = busy || !changes;
  const sessions = plan?.studyPlan.filter((s) => changes?.sessions.includes(s.session)) ?? [];
  const questions = plan?.practiceTest.filter((q) => changes?.questions.includes(questionKey(q))) ?? [];
  const waiting = (label: string) => (busy ? <Thinking label={label} /> : error ? <span className="text-bad">{error}</span> : null);

  const steps = [
    {
      title: "Lesson log",
      body: (
        <>
          <CiteList ids={changes?.newLessons ?? []} /> {trigger.title}
          <span className="block text-muted">
            {trigger.date} · {trigger.topicIds.join(", ")}
          </span>
        </>
      ),
    },
    {
      title: "What can be in the exam",
      body: pending
        ? waiting("Checking coverage")
        : changes!.flipped.length
          ? changes!.flipped.map((f) => (
              <span key={f.topicId} className="block">
                {f.topicId}: {STATUS_TEXT[f.from]} → <span className="font-medium text-good">{STATUS_TEXT[f.to]}</span>
              </span>
            ))
          : "No topic changed status.",
    },
    {
      title: "Study plan",
      body: pending
        ? waiting("Rebuilding the plan")
        : sessions.length
          ? sessions.map((s) => (
              <span key={s.session} className="block">
                Session {s.session}: {s.focus}
              </span>
            ))
          : "No session uses it yet.",
    },
    {
      title: "Practice test",
      body: pending
        ? waiting("Rewriting the paper")
        : questions.length
          ? questions.map((q) => (
              <span key={questionKey(q)} className="block">
                Part {q.part} Q{q.number} ({q.marks}m): {q.question.slice(0, 90)}…
              </span>
            ))
          : "No question uses it yet.",
    },
  ];

  return (
    <Panel className="border-accent/40">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Label>What your class just changed for students</Label>
        {!pending && (
          <button onClick={() => goTo("practice")} className="text-sm text-accent hover:underline">
            See it as a student →
          </button>
        )}
      </div>
      <ol className="grid gap-2 text-sm md:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="relative rounded-lg border border-line bg-sunken p-3">
            <p className="mb-1 text-xs font-medium text-accent">
              {i + 1}. {s.title}
            </p>
            <div className="space-y-1">{s.body}</div>
            {i < steps.length - 1 && <span className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-muted md:block">→</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

interface LessonDraft {
  unit: UnitId | null;
  topicIds: string[];
  title: string;
  summary: string;
  emphasis: string;
  excludeFrom: AssessmentId[];
}

/** Rough notes or a whiteboard photo in, a lesson-log entry out, for the teacher to confirm. */
function QuickLog({ onDraft }: { onDraft: (d: Partial<typeof DEMO_LESSON>) => void }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<UploadImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function draft() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await postJson<{ draft: LessonDraft; offSyllabus: string; droppedTopics: string[] }>("/api/lessons/draft", {
        text,
        images: images.map(({ mediaType, data }) => ({ mediaType, data })),
      });
      const { unit, ...rest } = r.draft;
      onDraft(unit ? { ...rest, unit } : rest);
      setNotice(
        [
          "Drafted below - check it, then add it to the log.",
          !r.draft.topicIds.length && "No syllabus topic matched; tick the topics yourself.",
          r.offSyllabus && `Not in the syllabus: ${r.offSyllabus}`,
          r.droppedTopics.length > 0 && `Left out (other unit): ${r.droppedTopics.join(", ")}`,
        ]
          .filter(Boolean)
          .join(" "),
      );
      setText("");
      setImages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-dashed border-line p-3">
      <p className="text-sm font-medium">Quick log from what you already have</p>
      <p className="text-xs text-muted">Paste rough notes or a slide outline, or snap the whiteboard. Topics are matched to the syllabus for you.</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="e.g. did usability testing today - think aloud, 5 users, SUS. told them it'll come in IA2 part B"
        className="mt-2 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent">
          Add photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                try {
                  const img = await readImage(file);
                  setImages((prev) => [...prev, img].slice(0, 3));
                } catch {
                  setError("Could not read that image.");
                }
              }
            }}
          />
        </label>
        {images.map((img, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- local data: URL preview
          <img key={i} src={img.preview} alt={`Photo ${i + 1}`} className="h-8 w-8 rounded border border-line object-cover" />
        ))}
        <button onClick={draft} disabled={busy || (!text.trim() && !images.length)} className="ml-auto text-sm font-medium text-accent hover:underline disabled:opacity-50">
          {busy ? "Drafting…" : "Draft the entry"}
        </button>
      </div>
      {busy && <Thinking label="Matching your notes to the syllabus" />}
      {error && <div className="mt-2"><ErrorNote message={error} /></div>}
      {notice && <p className="mt-2 text-xs text-accent">{notice}</p>}
    </div>
  );
}
