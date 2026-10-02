"use client";

import type { GradeResult } from "./Grade";

/** Marks the way an examiner writes them: 2½, ½. */
export function marks(n: number) {
  const whole = Math.floor(n);
  return n - whole >= 0.5 ? `${whole || ""}½` : String(whole);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface PenNote {
  n: number;
  criterion: string;
  lost: number;
  issue: string;
  sourceIds: string[];
  /** Line of the draft the note sits next to; -1 when the criterion has nothing in the draft. */
  line: number;
}

/** Where the examiner's pen goes: one note per criterion that lost marks, on the line its evidence quotes. */
export function penNotes(draft: string, result: GradeResult): PenNote[] {
  const lines = draft.split("\n").map(norm);
  const lineOf = (quote: string) => {
    const q = norm(quote.split(/\n|\.{3}|…/)[0] ?? "");
    if (!q) return -1;
    return lines.findIndex((l) => l && (l.includes(q) || (q.includes(l) && l.length > 12)));
  };
  return result.criteria
    .filter((c) => c.awarded < c.max)
    .map((c) => ({ criterion: c.name, lost: c.max - c.awarded, issue: c.issue, sourceIds: c.sourceIds, line: c.evidence ? lineOf(c.evidence) : -1 }))
    .sort((a, b) => (a.line < 0 ? 1e9 : a.line) - (b.line < 0 ? 1e9 : b.line))
    .map((note, i) => ({ ...note, n: i + 1 }));
}

/**
 * A student's answer on ruled paper, marked in red pen: mark-losing lines
 * underlined, the marks lost in the margin, the total circled at the top.
 */
export function AnswerSheet({
  draft,
  result,
  heading,
  maxHeight,
}: {
  draft: string;
  result: GradeResult;
  heading?: string;
  maxHeight?: string;
}) {
  const notes = penNotes(draft, result);
  const byLine = new Map<number, PenNote[]>();
  for (const n of notes) byLine.set(n.line, [...(byLine.get(n.line) ?? []), n]);
  const missing = byLine.get(-1) ?? [];
  const offTopic = result.relevance?.verdict === "off-topic";

  return (
    <div className="paper relative rounded-sm">
      <div className="pen-circle absolute -top-3 right-4 z-10 flex h-16 w-20 flex-col items-center justify-center bg-paper/90">
        <span className="red-pen text-2xl font-bold leading-none">{marks(result.score)}</span>
        <span className="red-pen text-xs leading-none">out of {result.outOf}</span>
      </div>
      <div className={`ruled overflow-y-auto rounded-sm pb-8 pl-16 pr-4 pt-8 ${offTopic ? "opacity-80" : ""}`} style={{ maxHeight }}>
        {heading && <p className="pr-24 font-serif text-[13px] font-semibold leading-8 text-paper-ink/70">{heading}</p>}
        {offTopic && (
          <p className="red-pen pr-24 text-lg leading-8">
            Not this question ✗ <span className="text-base">{result.relevance!.reason}</span>
          </p>
        )}
        {draft.split("\n").map((line, i) => {
          const here = byLine.get(i);
          return (
            <div key={i} className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] gap-3">
              <p className={`font-hand text-[16.5px] leading-8 ${here && !offTopic ? "pen-underline" : ""}`}>{line || " "}</p>
              {here && !offTopic && (
                <span className="red-pen whitespace-nowrap text-[15px] leading-8">
                  {here.map((n) => (
                    <span key={n.n} className="ml-2">
                      −{marks(n.lost)} <sup className="font-sans text-[10px] font-semibold">{n.n}</sup>
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}
        {!offTopic &&
          missing.map((n) => (
            <p key={n.n} className="red-pen text-[15px] leading-8">
              {n.criterion}: not attempted −{marks(n.lost)} <sup className="font-sans text-[10px] font-semibold">{n.n}</sup>
            </p>
          ))}
      </div>
    </div>
  );
}

/** The marks box from the front of an answer booklet, with one column per attempt. */
export function MarksBox({ columns }: { columns: { label: string; result: GradeResult }[] }) {
  const first = columns[0].result;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b-2 border-ink/70 text-left">
          <th className="py-1.5 pr-2 font-serif font-semibold">Criterion</th>
          <th className="w-12 py-1.5 text-center font-serif font-semibold">Max</th>
          {columns.map((c) => (
            <th key={c.label} className="w-20 py-1.5 text-center font-serif font-semibold">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {first.criteria.map((row) => (
          <tr key={row.id} className="border-b border-line">
            <td className="py-1.5 pr-2">{row.name}</td>
            <td className="py-1.5 text-center tabular-nums text-muted">{row.max}</td>
            {columns.map((c) => {
              const x = c.result.criteria.find((k) => k.id === row.id);
              const full = x && x.awarded === x.max;
              return (
                <td key={c.label} className={`red-pen py-1 text-center text-lg ${full ? "opacity-60" : ""}`}>
                  {x ? marks(x.awarded) : "–"}
                </td>
              );
            })}
          </tr>
        ))}
        <tr className="border-t-2 border-ink/70">
          <td className="py-2 pr-2 font-serif font-semibold">Total</td>
          <td className="py-2 text-center font-semibold tabular-nums">{first.outOf}</td>
          {columns.map((c) => (
            <td key={c.label} className="py-1.5 text-center">
              <span className="pen-circle red-pen inline-flex h-10 w-12 items-center justify-center text-xl font-bold">{marks(c.result.score)}</span>
            </td>
          ))}
        </tr>
        <tr>
          <td className="pt-1 text-xs text-muted" colSpan={2}>
            Grade band
          </td>
          {columns.map((c) => (
            <td key={c.label} className={`pt-1 text-center text-xs font-semibold ${c.result.percent < 50 ? "text-bad" : "text-good"}`}>
              {c.result.grade.replace(" (re-appear)", "")}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
