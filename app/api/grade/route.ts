import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { cacheGet, cacheKey, cacheSet } from "@/lib/cache";
import { claude, describeError, FALLBACK, MODEL } from "@/lib/claude";
import { calibrationStats, course, getCalibrations, getLessons, getPyq, getRubric, gradeFor, notes, pyqs, search } from "@/lib/kb";
import type { Source } from "@/lib/types";

const GradeSchema = z.object({
  criteria: z.array(
    z.object({
      criterionId: z.string(),
      awarded: z.number().describe("Most likely marks for this criterion, in steps of 0.5, never above its max"),
      low: z.number().describe("Lowest mark a fair examiner could give this criterion (equals awarded when certain)"),
      high: z.number().describe("Highest mark a fair examiner could give this criterion (equals awarded when certain)"),
      evidence: z.string().describe("Short verbatim quote from the draft that justifies the mark; empty string if nothing relevant"),
      issue: z.string().describe("What cost marks, specific to this draft; empty string if full marks"),
      fix: z.string().describe("The concrete change that would earn the missing marks"),
      sourceIds: z.array(z.string()).describe("Ids of the provided sources that support this judgement"),
    }),
  ),
  strengths: z.array(z.string()),
  nextSteps: z
    .array(z.object({ action: z.string(), why: z.string(), sourceIds: z.array(z.string()) }))
    .describe("At most 3, highest marks impact first"),
  cannotVerify: z.array(z.string()).describe("Things a human must check, e.g. hand-drawn sketches described only as placeholders"),
  summary: z.string().describe("Two sentences addressed to the student"),
});

const SYSTEM = `You are the internal examiner for ${course.code} ${course.title} at ${course.college}. You grade a student's draft answer exactly as the department would: against the given rubric, the college marking policy, the answer key and examiner notes, and what ${course.faculty} emphasised in class.

Rules:
- Score each rubric criterion separately. Use the answer key and examiner notes as the expected content; when there is no key, judge against the course material provided.
- Separate knowing from applying: naming and explaining a concept earns concept marks, but application marks need that concept applied to the given scenario with specific evidence. Accept valid alternative approaches when they are justified.
- Evidence must be a verbatim quote from the draft. If the draft has nothing for a criterion, award 0 and leave evidence empty.
- Diagrams, wireframes and empathy maps appear as bracketed placeholders like [Wireframe sketched]. Credit a placeholder only for what it states (labels, scenario-specific content, arrows). A bare placeholder earns at most half the diagram marks; list it under cannotVerify.
- Every issue and next step must point to the source that justifies it (rubric criterion, policy, examiner note, or the lesson where the professor stressed it). Cite only the source ids provided.
- Give each criterion a low-high band. Keep it tight (low = high = awarded) when the evidence is clear; widen it only where a reasonable examiner could differ, a diagram or handwriting cannot be verified, or the rubric is ambiguous for this answer.
- Teacher calibration sources show marks ${course.faculty} actually gave where an earlier prediction differed. When a similar situation appears, mark the way the teacher did and cite the calibration id.
- Be exact about the mark-losing step (e.g. "the Define stage states a solution - 'the canteen needs a mobile app' - instead of a user need"), not generic ("add more detail").`;

function block(s: Pick<Source, "id" | "title" | "text">) {
  return `<source id="${s.id}" title="${s.title}">\n${s.text}\n</source>`;
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    questionId?: string;
    questionText?: string;
    rubricId?: string;
    draft?: string;
    /** Present when the draft was transcribed from handwritten pages. */
    handwriting?: { legibility: string; uncertain: string[] };
  };
  const draft = body.draft?.trim();
  if (!draft) return Response.json({ error: "Paste your draft answer first." }, { status: 400 });

  const pyq = body.questionId ? getPyq(body.questionId) : undefined;
  const questionText = pyq?.question ?? body.questionText?.trim();
  if (!questionText) return Response.json({ error: "Pick a question or type one in." }, { status: 400 });

  const rubric = getRubric(body.rubricId ?? pyq?.rubricId ?? "RUB-10M-APP");
  if (!rubric) return Response.json({ error: "Unknown rubric." }, { status: 400 });
  const rubricMax = rubric.criteria.reduce((s, c) => s + c.max, 0);
  const questionMarks = pyq?.marks ?? rubricMax;

  // Retrieval: everything the examiner would have on the desk for this question.
  const topicId = pyq?.topicId;
  const lessons = await getLessons();
  const context: Pick<Source, "id" | "title" | "text">[] = [];
  const add = (s: Pick<Source, "id" | "title" | "text">) => {
    if (!context.some((c) => c.id === s.id)) context.push(s);
  };
  add({
    id: rubric.id,
    title: rubric.title,
    text: rubric.criteria.map((c) => `${c.id} ${c.name} (max ${c.max}): ${c.descriptor}`).join("\n") + `\nDeductions: ${rubric.deductions.join(" ")}`,
  });
  const policy = notes.find((n) => n.id === "POLICY-IA");
  if (policy) add(policy);
  if (pyq) {
    add({
      id: pyq.id,
      title: `Question (${pyq.year} ${pyq.exam}, ${pyq.marks} marks)`,
      text: `${pyq.question}${pyq.answerKey ? `\nAnswer key: ${pyq.answerKey}` : ""}${pyq.examinerNote ? `\nExaminer note: ${pyq.examinerNote}` : ""}`,
    });
  }
  if (topicId) {
    for (const l of lessons.filter((l) => l.topicIds.includes(topicId))) {
      add({ id: l.id, title: `Lesson ${l.date}: ${l.title}`, text: `${l.summary} Faculty emphasis: ${l.emphasis}` });
    }
    for (const n of notes.filter((n) => n.topicIds.includes(topicId))) add(n);
    for (const q of pyqs.filter((q) => q.topicId === topicId && q.id !== pyq?.id && q.examinerNote)) {
      add({ id: q.id, title: `Related question ${q.year} ${q.exam}`, text: `${q.question} Examiner note: ${q.examinerNote}` });
    }
  }
  for (const hit of await search(`${questionText} ${draft.slice(0, 600)}`, { types: ["lesson", "note", "pyq"], k: 4 })) {
    add(hit);
  }
  // How this teacher actually marked earlier predictions on the same rubric,
  // same question first, most informative (largest disagreement) first.
  const calibrations = (await getCalibrations()).filter((c) => c.rubricId === rubric.id);
  const relevantCal = [...calibrations]
    .sort(
      (a, b) =>
        Number(b.questionId === pyq?.id) - Number(a.questionId === pyq?.id) ||
        Math.abs(b.predicted - b.actual) / b.outOf - Math.abs(a.predicted - a.actual) / a.outOf,
    )
    .slice(0, 6);
  for (const c of relevantCal) {
    add({
      id: c.id,
      title: `Teacher calibration (${c.student})`,
      text: `Predicted ${c.predicted}/${c.outOf}, ${course.faculty} gave ${c.actual}/${c.outOf} for ${c.questionId ?? "a custom question"}.${c.note ? ` Reason: ${c.note}` : ""}`,
    });
  }
  const handwritingNote = body.handwriting
    ? `

This draft was transcribed from handwritten pages (legibility: ${body.handwriting.legibility}). Uncertain parts of the transcription: ${
        body.handwriting.uncertain.join("; ") || "none"
      }. Do not penalise transcription noise; widen the band for criteria that depend on uncertain parts and list them under cannotVerify.`
    : "";

  // Same draft + same rubric + same course context -> same result, instantly.
  const key = cacheKey({
    MODEL,
    rubric: rubric.id,
    questionText,
    questionMarks,
    draft,
    handwritingNote,
    context: context.map((c) => [c.id, c.text]),
  });
  const stats = calibrationStats(calibrations);
  const hit = await cacheGet<object>(key);
  if (hit) return Response.json({ ...hit, calibration: stats, cached: true });

  const started = Date.now();
  try {
    const response = await claude().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "high", format: betaZodOutputFormat(GradeSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `${context.map(block).join("\n\n")}

<question marks="${questionMarks}" rubric="${rubric.id}">
${questionText}
</question>

<student_draft>
${draft}
</student_draft>

Grade the draft against every criterion of ${rubric.id} (${rubric.criteria.map((c) => `${c.id} max ${c.max}`).join(", ")}).${handwritingNote}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ error: "The model declined to grade this draft." }, { status: 422 });
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      return Response.json({ error: "The grader returned an unreadable result - try again." }, { status: 502 });
    }

    // Marks are computed here, not trusted from the model: clamp each
    // criterion to its max, round to half marks, and sum.
    const allowedIds = new Set(context.map((c) => c.id));
    let droppedCitations = 0;
    const keepValid = (ids: string[]) => {
      const valid = ids.filter((id) => allowedIds.has(id));
      droppedCitations += ids.length - valid.length;
      return valid;
    };
    const half = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n * 2) / 2));
    const criteria = rubric.criteria.map((c) => {
      const g = parsed.criteria.find((x) => x.criterionId === c.id);
      const awarded = g ? half(g.awarded, c.max) : 0;
      return {
        id: c.id,
        name: c.name,
        max: c.max,
        awarded,
        low: g ? Math.min(awarded, half(g.low, c.max)) : 0,
        high: g ? Math.max(awarded, half(g.high, c.max)) : c.max,
        evidence: g?.evidence ?? "",
        issue: g?.issue ?? "Not assessed by the grader.",
        fix: g?.fix ?? "",
        sourceIds: keepValid(g?.sourceIds ?? []),
      };
    });
    const scale = (rubricMarks: number) => Math.round((rubricMarks / rubricMax) * questionMarks * 2) / 2;
    const score = scale(criteria.reduce((s, c) => s + c.awarded, 0));
    const range = { low: scale(criteria.reduce((s, c) => s + c.low, 0)), high: scale(criteria.reduce((s, c) => s + c.high, 0)) };
    const percent = Math.round((score / questionMarks) * 100);
    // Certainty comes from the band width, computed here, not self-reported.
    const width = (range.high - range.low) / questionMarks;
    const certainty = width <= 0.1 ? "high" : width <= 0.25 ? "medium" : "low";

    const result = {
      question: { id: pyq?.id ?? null, text: questionText, marks: questionMarks },
      rubric: { id: rubric.id, title: rubric.title },
      score,
      range,
      outOf: questionMarks,
      percent,
      grade: gradeFor(percent),
      criteria,
      strengths: parsed.strengths,
      nextSteps: parsed.nextSteps.slice(0, 3).map((s) => ({ ...s, sourceIds: keepValid(s.sourceIds) })),
      cannotVerify: parsed.cannotVerify,
      summary: parsed.summary,
      confidence: certainty,
      handwritten: Boolean(body.handwriting),
      grounding: { sourcesProvided: context.map((c) => ({ id: c.id, title: c.title, text: c.text })), droppedCitations },
      elapsedMs: Date.now() - started,
    };
    await cacheSet(key, result);
    return Response.json({ ...result, calibration: stats, cached: false });
  } catch (err) {
    const { status, message } = describeError(err);
    return Response.json({ error: message }, { status });
  }
}
