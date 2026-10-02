"use client";

import { useRef, useState } from "react";
import { readImage, type UploadImage } from "./images";
import { ErrorNote, postJson, Thinking } from "./ui";

interface TranscribeResult {
  transcript: string;
  diagrams: { label: string; description: string; confidence: "high" | "medium" | "low" }[];
  unclear: { text: string; reason: string }[];
  legibility: "high" | "medium" | "low";
}

export interface HandwritingMeta {
  legibility: string;
  /** Things the student must check before trusting the grade. */
  uncertain: string[];
  diagrams: TranscribeResult["diagrams"];
  unclear: TranscribeResult["unclear"];
}

const CONF_STYLE = {
  high: "bg-good-soft text-good",
  medium: "bg-warn-soft text-warn",
  low: "bg-bad-soft text-bad",
} as const;

/** Photo of a handwritten answer -> transcript the student checks before grading. */
export function Handwriting({
  questionId,
  questionText,
  meta,
  onTranscribed,
}: {
  questionId?: string;
  questionText?: string;
  meta: HandwritingMeta | null;
  onTranscribed: (transcript: string, meta: HandwritingMeta) => void;
}) {
  const [images, setImages] = useState<UploadImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function add(files: FileList | null) {
    if (!files) return;
    setError("");
    try {
      const next = await Promise.all([...files].slice(0, 4 - images.length).map(readImage));
      setImages((prev) => [...prev, ...next].slice(0, 4));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that image.");
    }
  }

  async function transcribe() {
    setBusy(true);
    setError("");
    try {
      const r = await postJson<TranscribeResult>("/api/transcribe", {
        questionId,
        questionText,
        images: images.map(({ mediaType, data }) => ({ mediaType, data })),
      });
      onTranscribed(r.transcript, {
        legibility: r.legibility,
        diagrams: r.diagrams,
        unclear: r.unclear,
        uncertain: [
          ...r.unclear.map((u) => `"${u.text}" (${u.reason})`),
          ...r.diagrams.filter((d) => d.confidence !== "high").map((d) => `${d.label} diagram (${d.confidence} confidence)`),
        ],
      });
      setImages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => add(e.target.files)} />
        <button
          onClick={() => input.current?.click()}
          disabled={busy || images.length >= 4}
          className="rounded-lg border border-dashed border-line px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Upload handwritten pages
        </button>
        {images.map((img, i) => (
          <span key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local data: URL preview */}
            <img src={img.preview} alt={`Page ${i + 1}`} className="h-12 w-10 rounded border border-line object-cover" />
            <button
              onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
              className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-ink text-[10px] leading-4 text-bg"
              aria-label={`Remove page ${i + 1}`}
            >
              ×
            </button>
          </span>
        ))}
        {images.length > 0 && (
          <button onClick={transcribe} disabled={busy} className="text-sm font-medium text-accent hover:underline disabled:opacity-50">
            {busy ? "Reading…" : `Transcribe ${images.length} page${images.length > 1 ? "s" : ""}`}
          </button>
        )}
      </div>
      {busy && <Thinking label="Reading handwriting and describing diagrams…" />}
      {error && <ErrorNote message={error} />}

      {meta && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft/50 p-3 text-sm">
          <p className="font-medium">
            Check the transcript above before grading <span className="font-normal text-muted">· legibility {meta.legibility}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Fix anything misread directly in the text. Parts marked uncertain widen your predicted range instead of being guessed.
          </p>
          {meta.diagrams.length > 0 && (
            <ul className="mt-2 space-y-1">
              {meta.diagrams.map((d, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className={`h-fit shrink-0 rounded px-1.5 py-0.5 font-medium ${CONF_STYLE[d.confidence]}`}>{d.confidence}</span>
                  <span>
                    <span className="font-medium">{d.label}:</span> {d.description}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {meta.unclear.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {meta.unclear.map((u, i) => (
                <li key={i}>
                  <span className="font-medium text-warn">Unclear:</span> &ldquo;{u.text}&rdquo; - {u.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
