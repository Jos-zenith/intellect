"use client";

import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import type { Source } from "@/lib/types";

// ---------------------------------------------------------------------------
// Citations: any [ID] in model text becomes a chip that opens the source.

const SourceCtx = createContext<(id: string) => void>(() => {});
export const useOpenSource = () => useContext(SourceCtx);

export function SourceProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <SourceCtx.Provider value={setOpenId}>
      {children}
      {openId && <SourceDrawer id={openId} onClose={() => setOpenId(null)} />}
    </SourceCtx.Provider>
  );
}

const TYPE_LABEL: Record<Source["type"], string> = {
  syllabus: "Syllabus",
  lesson: "Lesson log",
  pyq: "Previous year Q",
  rubric: "Rubric",
  note: "Faculty note",
  calibration: "Teacher calibration",
};

function SourceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [state, setState] = useState<{ id: string; source?: Source; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/kb?source=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => live && setState({ id, source: d.source, error: d.error }))
      .catch(() => live && setState({ id, error: "Could not load source" }));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = state?.id === id ? state : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <aside
        className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-accent">{id}</p>
            {current?.source && <p className="mt-1 text-xs uppercase tracking-wide text-muted">{TYPE_LABEL[current.source.type]}</p>}
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-sunken" aria-label="Close">
            Close
          </button>
        </div>
        {!current && <Thinking label="Loading source" />}
        {current?.error && <p className="text-sm text-bad">{current.error}</p>}
        {current?.source && (
          <>
            <h3 className="text-lg font-semibold leading-snug">{current.source.title}</h3>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{current.source.text}</p>
            {current.source.topicIds.length > 0 && (
              <p className="mt-4 text-xs text-muted">Topics: {current.source.topicIds.join(", ")}</p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

export function Cite({ id }: { id: string }) {
  const open = useOpenSource();
  return (
    <button
      onClick={() => open(id)}
      className="mx-0.5 inline-flex items-center rounded border border-accent/30 bg-accent-soft px-1.5 py-px align-baseline font-mono text-[11px] text-accent hover:border-accent"
      title={`Open ${id}`}
    >
      {id}
    </button>
  );
}

export function CiteList({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id) => (
        <Cite key={id} id={id} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Minimal markdown: headings, lists, bold, inline code and [ID] citations.

const ID = String.raw`(?:[A-Z]{2,}-[A-Za-z0-9-]+|U\d\.T\d)`;
const CITE_GROUP = new RegExp(String.raw`\[(${ID}(?:\s*[,;]\s*${ID})*)\]`, "g");

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = new RegExp(String.raw`${CITE_GROUP.source}|\*\*([^*]+)\*\*|\x60([^\x60]+)\x60`, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1]) {
      out.push(
        <Fragment key={key}>
          {m[1].split(/\s*[,;]\s*/).map((id) => (
            <Cite key={id} id={id} />
          ))}
        </Fragment>,
      );
    } else if (m[2]) {
      out.push(<strong key={key}>{inline(m[2], key)}</strong>);
    } else if (m[3]) {
      out.push(
        <code key={key} className="rounded bg-sunken px-1 font-mono text-[0.9em]">
          {m[3]}
        </code>,
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={`l${blocks.length}`} className={`my-2 space-y-1 pl-5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((item, i) => (
          <li key={i}>{inline(item, `li${blocks.length}-${i}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      return;
    }
    flush();
    if (heading) {
      blocks.push(
        <p key={i} className="mt-4 mb-1 font-semibold first:mt-0">
          {inline(heading[2], `h${i}`)}
        </p>,
      );
    } else if (line.trim()) {
      blocks.push(
        <p key={i} className="my-2 first:mt-0">
          {inline(line, `p${i}`)}
        </p>,
      );
    }
  });
  flush();
  return <div className="leading-relaxed">{blocks}</div>;
}

// ---------------------------------------------------------------------------

export function Thinking({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <span className="inline-flex gap-0.5">
        <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      {label}
    </p>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{message}</p>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-panel p-5 ${className}`}>{children}</section>;
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{children}</p>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  type?: "button" | "submit";
}) {
  const style =
    variant === "primary"
      ? "bg-accent text-white hover:opacity-90 dark:text-[#131210]"
      : "border border-line bg-panel text-ink hover:bg-sunken";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
    >
      {children}
    </button>
  );
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`animate-pulse space-y-2.5 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 rounded bg-sunken" style={{ width: `${[92, 78, 85, 64, 88][i % 5]}%` }} />
      ))}
    </div>
  );
}

/** Where a model result came from: live, cached, recorded, or a hand-written sample. */
export interface Provenance {
  cached?: boolean;
  recorded?: { at: string; origin: "recorded" | "authored"; liveError?: string; stale?: boolean };
  model?: string;
  elapsedMs?: number;
}

export function ProvenanceNote({ of, onRunLive, busy }: { of: Provenance; onRunLive?: () => void; busy?: boolean }) {
  const r = of.recorded;
  const date = r && new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const text = r
    ? r.origin === "authored"
      ? "Sample result prepared offline to show the format. Not a live model run."
      : `Recorded run of ${of.model ?? "the model"} on ${date}.`
    : of.cached
      ? "Same input as an earlier run, so the stored result is shown."
      : `Live run${of.elapsedMs ? ` · ${(of.elapsedMs / 1000).toFixed(0)} s` : ""}.`;
  return (
    <p className="text-xs text-muted">
      {text}
      {r?.stale && " It was made before the latest lesson-log change."}
      {r?.liveError && <span className="text-warn"> Live run unavailable: {r.liveError}</span>}
      {onRunLive && (r || of.cached) && (
        <button onClick={onRunLive} disabled={busy} className="ml-1.5 text-accent hover:underline disabled:opacity-50">
          {busy ? "Running live…" : "Run it live"}
        </button>
      )}
    </p>
  );
}
