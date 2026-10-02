"use client";

import { useCallback, useEffect, useState } from "react";
import type { AssessmentId, Course, Lesson, UnitId } from "@/lib/types";
import { ClassDashboard } from "./ClassDashboard";
import type { ClassRun } from "./classRun";
import { readImage, type UploadImage } from "./images";
import { Button, Cite, ErrorNote, Label, Panel, postJson, Thinking } from "./ui";

const EMPTY = {
  date: "2026-10-05",
  unit: "U3" as UnitId,
  topicIds: [] as string[],
  title: "",
  summary: "",
  emphasis: "",
  excludeFrom: [] as AssessmentId[],
};

const MONDAY_DEMO = {
  date: "2026-10-05",
  unit: "U4" as UnitId,
  topicIds: ["U4.T5"],
  title: "Conducting usability tests",
  summary:
    "Planned and ran a live usability test of the library app with 5 students: test goal, recruiting representative participants, 3 tasks on the red route, think-aloud protocol, metrics (task success, time on task, errors, SUS score), and ranking findings by severity.",
  emphasis: "This WILL be in IA2 Part B: plan a usability test for a given app - goal, 5 participants, 3 realistic tasks, metrics, and what you would change in the next iteration.",
  excludeFrom: [] as AssessmentId[],
};

export function Teacher({ course, classRun, questionTitle }: { course: Course; classRun: ClassRun; questionTitle: string }) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [form, setForm] = useState(EMPTY);
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
      await postJson("/api/lessons", form);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    await fetch("/api/lessons", { method: "DELETE" });
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <div className="mb-3 flex items-center justify-between gap-2">
            <Label>Log today&apos;s class</Label>
            <button onClick={() => setForm(MONDAY_DEMO)} className="text-xs text-accent hover:underline">
              Fill Monday&apos;s class (demo)
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
            <p className="text-xs text-muted">Students&apos; plans, practice tests and answers update from the next request, with no re-indexing.</p>
          </div>
        </Panel>

        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <Label>Lesson log ({lessons.length})</Label>
            {lessons.some((l) => l.addedByTeacher) && (
              <button onClick={reset} className="text-xs text-muted hover:text-bad">
                Remove classes added in this demo
              </button>
            )}
          </div>
          <ol className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {[...lessons].reverse().map((l) => (
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

interface LessonDraft {
  unit: UnitId | null;
  topicIds: string[];
  title: string;
  summary: string;
  emphasis: string;
  excludeFrom: AssessmentId[];
}

/** Rough notes or a whiteboard photo in, a lesson-log entry out, for the teacher to confirm. */
function QuickLog({ onDraft }: { onDraft: (d: Partial<typeof MONDAY_DEMO>) => void }) {
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
