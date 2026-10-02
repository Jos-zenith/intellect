"use client";

import { useEffect, useRef, useState } from "react";
import type { Course, Lesson, Pyq, Rubric } from "@/lib/types";
import { Cite, ErrorNote, RichText, Skeleton, Thinking } from "./ui";

interface ToolStep {
  name: string;
  input?: Record<string, unknown>;
  ids?: string[];
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  steps?: ToolStep[];
  error?: string;
  pending?: boolean;
}

const suggestions = (course: Course) => [
  "What should I focus on for IA2, ranked by marks?",
  "Is Figma prototyping coming in IA2?",
  `How did ${course.faculty} want design thinking questions answered?`,
  "Why do students lose marks on application questions?",
];

const TOOL_LABEL: Record<string, string> = {
  search_knowledge_base: "Searched the knowledge base",
  get_exam_coverage: "Checked exam coverage",
  get_lesson_log: "Read the lesson log",
};

function describeStep(step: ToolStep) {
  const input = step.input ?? {};
  const bits = [
    typeof input.query === "string" ? `"${input.query}"` : null,
    typeof input.assessment === "string" ? input.assessment : null,
    typeof input.unit === "string" ? input.unit : null,
    Array.isArray(input.types) && input.types.length ? input.types.join("/") : null,
    input.from || input.to ? `${input.from ?? "start"} to ${input.to ?? "today"}` : null,
  ].filter(Boolean);
  return `${TOOL_LABEL[step.name] ?? step.name}${bits.length ? `: ${bits.join(", ")}` : ""}`;
}

export function Ask({ course, pyqs, rubrics }: { course: Course; pyqs: Pyq[]; rubrics: Rubric[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const updateLast = (fn: (t: Turn) => Turn) =>
    setTurns((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = [...turns.filter((t) => !t.error && t.content), { role: "user" as const, content: question }];
    setTurns([...turns, { role: "user", content: question }, { role: "assistant", content: "", steps: [], pending: true }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "text") updateLast((t) => ({ ...t, content: t.content + ev.delta }));
          else if (ev.type === "tool") updateLast((t) => ({ ...t, steps: [...(t.steps ?? []), { name: ev.name, input: ev.input }] }));
          else if (ev.type === "tool_result")
            updateLast((t) => {
              const steps = [...(t.steps ?? [])];
              const idx = steps.findIndex((s) => s.name === ev.name && !s.ids);
              if (idx >= 0) steps[idx] = { ...steps[idx], ids: ev.ids };
              return { ...t, steps };
            });
          else if (ev.type === "error") updateLast((t) => ({ ...t, error: ev.message }));
        }
      }
    } catch (err) {
      updateLast((t) => ({ ...t, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      updateLast((t) => ({ ...t, pending: false }));
      setBusy(false);
    }
  }

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
      className={`flex gap-2 rounded-md border border-line bg-panel p-2 shadow-sm ${turns.length ? "sticky bottom-4" : ""}`}
    >
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="e.g. Which 10-mark questions repeat most in IA2?"
        className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        disabled={busy || !input.trim()}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#15171b]"
      >
        {busy ? "…" : "Ask"}
      </button>
    </form>
  );

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 && (
        <>
          <div>
            <h1 className="max-w-4xl font-serif text-[2rem] font-bold leading-tight tracking-tight">Ask the course, not the internet.</h1>
            <p className="mt-2 max-w-3xl text-[15px] text-muted">
              Answers come only from {course.code}&apos;s syllabus, {course.faculty}&apos;s lesson log, past papers with examiner notes and the college rubrics,
              and every claim links to its source.
            </p>
          </div>
          {form}
          <p className="text-sm text-muted">
            Try:{" "}
            {suggestions(course).map((q, i) => (
              <span key={q}>
                {i > 0 && " · "}
                <button onClick={() => send(q)} className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid">
                  {q}
                </button>
              </span>
            ))}
          </p>
          <CourseIndex course={course} pyqs={pyqs} rubrics={rubrics} ask={send} />
        </>
      )}

      {turns.map((t, i) =>
        t.role === "user" ? (
          <p key={i} className="mt-4 font-serif text-xl font-semibold first:mt-0">
            {t.content}
          </p>
        ) : (
          <div key={i} className="max-w-full rounded-md border border-line bg-panel px-5 py-4">
            {!!t.steps?.length && (
              <ul className="mb-3 space-y-1 border-b border-line pb-3 text-xs text-muted">
                {t.steps.map((s, j) => (
                  <li key={j}>
                    <span className="text-accent">↳</span> {describeStep(s)}
                    {s.ids && <span> · {s.ids.length} sources</span>}
                  </li>
                ))}
              </ul>
            )}
            {t.content && <RichText text={t.content} />}
            {t.pending && !t.content && <Thinking label={t.steps?.length ? "Reading sources" : "Thinking"} />}
            {t.error && <ErrorNote message={t.error} />}
          </div>
        ),
      )}
      <div ref={endRef} />

      {turns.length > 0 && form}
    </div>
  );
}

/** What can be asked about: the course itself, every row one click from a question. */
function CourseIndex({ course, pyqs, rubrics, ask }: { course: Course; pyqs: Pyq[]; rubrics: Rubric[]; ask: (q: string) => void }) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  useEffect(() => {
    fetch("/api/lessons")
      .then((r) => r.json())
      .then((d: { lessons: Lesson[] }) => setLessons(d.lessons))
      .catch(() => setLessons([]));
  }, []);
  const maxMarks = Math.max(...course.units.map((u) => u.endSemMarks));
  const upcoming = course.assessments.filter((a) => a.date >= course.today);
  const recent = [...pyqs].sort((a, b) => b.year - a.year || b.marks - a.marks).slice(0, 7);
  const row = "group block w-full rounded px-2 py-2 text-left transition hover:bg-sunken";
  return (
    <div className="mt-4 grid gap-8 lg:grid-cols-3">
      <section>
        <h2 className="font-serif text-lg font-semibold">The syllabus, by marks</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {course.units.map((u) => (
            <li key={u.id}>
              <button onClick={() => ask(`What do I need to know from ${u.id} ${u.title} for the exams, and how is it usually asked?`)} className={row}>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    <span className="font-mono text-xs text-muted">{u.id}</span> {u.title}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">{u.endSemMarks} marks</span>
                </span>
                <span className="mt-1.5 block h-1 rounded bg-sunken">
                  <span className="block h-1 rounded bg-accent" style={{ width: `${(u.endSemMarks / maxMarks) * 100}%` }} />
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {u.topics.length} topics · {u.hours} hours <span className="text-accent opacity-0 group-hover:opacity-100">· ask about it →</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <h2 className="mt-6 font-serif text-lg font-semibold">How answers are marked</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {rubrics.map((r) => (
            <li key={r.id}>
              <button onClick={() => ask(`How is a ${r.title.toLowerCase()} marked, and where do students usually lose marks?`)} className={row}>
                <span className="block text-sm">{r.title}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {r.criteria.map((c) => `${c.name} ${c.max}`).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-serif text-lg font-semibold">Coming up</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {upcoming.map((a) => (
            <li key={a.id}>
              <button onClick={() => ask(`What should I focus on for ${a.name}, ranked by marks, given what has been taught so far?`)} className={row}>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{a.name}</span>
                  <span className="shrink-0 font-serif tabular-nums text-muted">
                    {new Date(a.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  Units {a.units.join(", ")} · {a.total} marks · {a.pattern.map((p) => `Part ${p.part} ${p.count}×${p.marks}`).join(", ")}
                </span>
                <span className="block text-xs text-accent opacity-0 group-hover:opacity-100">What should I focus on? →</span>
              </button>
            </li>
          ))}
        </ul>
        <h2 className="mt-6 font-serif text-lg font-semibold">Recent classes</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {!lessons && (
            <li className="py-3">
              <Skeleton lines={5} />
            </li>
          )}
          {lessons
            ?.slice(-6)
            .reverse()
            .map((l) => (
              <li key={l.id}>
                <div className={row}>
                  <span className="flex items-baseline justify-between gap-3 text-xs text-muted">
                    <Cite id={l.id} />
                    <span className="font-serif">{new Date(l.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  </span>
                  <button
                    onClick={() => ask(`What did ${course.faculty} stress in the class on ${l.title} (${l.id}), and how will it be marked?`)}
                    className="mt-1 text-left text-sm hover:text-accent"
                  >
                    {l.title}
                  </button>
                </div>
              </li>
            ))}
        </ul>
      </section>

      <section>
        <h2 className="font-serif text-lg font-semibold">Past papers, with examiner notes</h2>
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {recent.map((q) => (
            <li key={q.id}>
              <div className={row}>
                <span className="flex items-baseline justify-between gap-3 text-xs text-muted">
                  <Cite id={q.id} />
                  <span>
                    {q.year} {q.exam} · {q.marks}m
                  </span>
                </span>
                <button onClick={() => ask(`How should I answer ${q.id} to get full marks?`)} className="mt-1 line-clamp-2 text-left text-sm hover:text-accent">
                  {q.question}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">{pyqs.length} past questions in all. Click one to ask how to answer it.</p>
      </section>
    </div>
  );
}
