"use client";

import { useEffect, useRef, useState } from "react";
import type { Course } from "@/lib/types";
import { ErrorNote, RichText, Thinking } from "./ui";

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

export function Ask({ course }: { course: Course }) {
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

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 && (
        <div className="rounded-xl border border-line bg-panel p-6">
          <p className="text-lg font-semibold">
            Ask anything about {course.code} {course.title}, and get answers grounded in what was actually taught.
          </p>
          <p className="mt-1 text-sm text-muted">
            Every answer is built from the syllabus, {course.faculty}&apos;s lesson log, past papers with examiner notes, and the college rubrics. Click any
            citation to see the source.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions(course).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-line px-3 py-1.5 text-left text-sm hover:border-accent hover:text-accent"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {turns.map((t, i) =>
        t.role === "user" ? (
          <div key={i} className="ml-auto max-w-[85%] rounded-xl bg-accent px-4 py-2.5 text-white dark:text-[#131210]">
            {t.content}
          </div>
        ) : (
          <div key={i} className="max-w-full rounded-xl border border-line bg-panel px-5 py-4">
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4 flex gap-2 rounded-xl border border-line bg-panel p-2 shadow-sm"
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
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#131210]"
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
