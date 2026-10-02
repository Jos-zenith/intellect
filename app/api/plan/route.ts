import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { cacheGet, cacheKey, cacheSet } from "@/lib/cache";
import { claude, describeError, FALLBACK, MODEL } from "@/lib/claude";
import { course, coverageFor, getAssessment, getLessons, pyqs, topicLabel } from "@/lib/kb";
import { meta, recordedPlanByKey, recordedPlanFallback } from "@/lib/recorded";
import type { AssessmentId } from "@/lib/types";

const PlanSchema = z.object({
  priorities: z
    .array(z.object({ topicId: z.string(), why: z.string(), sourceIds: z.array(z.string()) }))
    .describe("Taught topics ranked by marks at stake, highest first"),
  studyPlan: z
    .array(
      z.object({
        session: z.number(),
        focus: z.string(),
        topicIds: z.array(z.string()),
        tasks: z.array(z.string()),
        sourceIds: z.array(z.string()),
      }),
    )
    .describe("4 to 7 study sessions leading up to the exam"),
  practiceTest: z.array(
    z.object({
      part: z.string(),
      number: z.number(),
      marks: z.number(),
      topicId: z.string(),
      question: z.string(),
      basedOnLessons: z.array(z.string()).describe("Lesson ids this question is grounded in"),
      similarPyqs: z.array(z.string()).describe("Previous year question ids it resembles, may be empty"),
      examinerLooksFor: z.string().describe("One line: what earns the marks, from rubric and lesson emphasis"),
    }),
  ),
});

const SYSTEM = `You build exam preparation for ${course.code} ${course.title} at ${course.college} (${course.faculty}).

Your one non-negotiable rule is logic continuity: students may only be tested and coached on what was actually taught. Every practice question and study session must use topics whose status is "taught" in the coverage table, and must cite the lesson ids that taught them. Never use topics marked "excluded" or "not-taught" - list nothing from them, not even as a bonus.

Mirror the real paper: follow the given pattern exactly (one question per slot, marks per slot as given). Model new questions on the style, scenarios and traps of the previous year questions and on what the professor emphasised in each lesson, but do not copy a previous year question verbatim. Part B questions should be scenario-based application questions (a concrete product or campus service, its users and a constraint) at the difficulty of the previous papers. Rank priorities by marks at stake: unit weightage, how often the topic has carried marks in previous papers, and how strongly the professor flagged it.`;

export async function POST(req: Request) {
  const body = (await req.json()) as {
    assessmentId?: AssessmentId;
    asOf?: string;
    /** Skip the cache and recorded results and call the model. */
    live?: boolean;
    /** Return the context key and the code-computed parts only, without calling the model. */
    keyOnly?: boolean;
  };
  const assessment = getAssessment(body.assessmentId ?? "IA2");
  const asOf = body.asOf ?? course.today;

  const coverage = await coverageFor(assessment.id, asOf);
  const taught = coverage.filter((c) => c.status === "taught");
  if (!taught.length) {
    return Response.json({ error: `Nothing from ${assessment.id} has been taught as of ${asOf}.` }, { status: 400 });
  }

  const lessons = (await getLessons()).filter((l) => l.date <= asOf && assessment.units.includes(l.unit));
  const relatedPyqs = pyqs.filter((q) => assessment.units.includes(q.unit));
  const daysLeft = Math.max(0, Math.round((Date.parse(assessment.date) - Date.parse(asOf)) / 86_400_000));

  const prompt = `Exam: ${assessment.name} (${assessment.id}) on ${assessment.date} - ${daysLeft} days from ${asOf}. Total ${assessment.total} marks.
Pattern:
${assessment.pattern.map((p) => `Part ${p.part}: ${p.count} questions x ${p.marks} marks (${p.note})`).join("\n")}

<coverage>
${coverage.map((c) => `${c.topicId} | ${c.status} | ${c.name} | ${c.reason} | previous-year marks: ${c.pyqMarks}`).join("\n")}
</coverage>

<lesson_log>
${lessons.map((l) => `[${l.id}] ${l.date} ${l.unit} topics ${l.topicIds.join(", ")} - ${l.title}. ${l.summary} Emphasis: ${l.emphasis}${l.excludeFrom ? ` Excluded from ${l.excludeFrom.join(", ")}.` : ""}`).join("\n")}
</lesson_log>

<previous_year_questions>
${relatedPyqs.map((q) => `[${q.id}] ${q.year} ${q.exam} ${q.marks}m topic ${q.topicId}: ${q.question}${q.examinerNote ? ` Examiner note: ${q.examinerNote}` : ""}`).join("\n")}
</previous_year_questions>

Produce the priorities, a study plan for the ${daysLeft} days left, and a full practice paper following the pattern. Allowed topic ids: ${taught.map((t) => t.topicId).join(", ")}.`;

  // Same exam, date and lesson log -> same plan. A new lesson changes the key.
  const key = cacheKey({ MODEL, kind: "plan", prompt });
  if (body.keyOnly) return Response.json({ key, assessment, asOf, daysLeft, coverage, lessonIds: lessons.map((l) => l.id) });
  if (!body.live) {
    const hit = await cacheGet<object>(key);
    if (hit) return Response.json({ ...hit, cached: true });
    const rec = recordedPlanByKey(key);
    if (rec) return Response.json({ ...rec.result, recorded: meta(rec) });
  }

  const started = Date.now();
  try {
    const response = await claude().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "medium", format: betaZodOutputFormat(PlanSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") {
      return Response.json({ error: "The model declined this request." }, { status: 422 });
    }
    const plan = response.parsed_output;
    if (!plan) return Response.json({ error: "The planner returned an unreadable result - try again." }, { status: 502 });

    // Continuity check, done in code: every question must sit on a taught
    // topic and cite a lesson that actually covered that topic before asOf.
    const status = new Map(coverage.map((c) => [c.topicId, c]));
    const lessonById = new Map(lessons.map((l) => [l.id, l]));
    const questions = plan.practiceTest.map((q) => {
      const cov = status.get(q.topicId);
      const groundedLessons = q.basedOnLessons.filter((id) => lessonById.get(id)?.topicIds.includes(q.topicId));
      const problems: string[] = [];
      if (!cov) problems.push(`${q.topicId} is not in the ${assessment.id} syllabus`);
      else if (cov.status !== "taught") problems.push(`${q.topicId} is ${cov.status}`);
      if (!groundedLessons.length) problems.push("no lesson in the log covers this topic");
      return {
        ...q,
        topicName: topicLabel(q.topicId),
        basedOnLessons: groundedLessons,
        similarPyqs: q.similarPyqs.filter((id) => relatedPyqs.some((p) => p.id === id)),
        problems,
      };
    });

    const result = {
      assessment,
      asOf,
      daysLeft,
      coverage,
      lessonIds: lessons.map((l) => l.id),
      priorities: plan.priorities
        .filter((p) => status.get(p.topicId)?.status === "taught")
        .map((p) => ({ ...p, topicName: topicLabel(p.topicId) })),
      studyPlan: plan.studyPlan,
      practiceTest: questions,
      check: {
        questions: questions.length,
        totalMarks: questions.reduce((s, q) => s + q.marks, 0),
        expectedMarks: assessment.total,
        outOfScope: questions.filter((q) => q.problems.length).length,
      },
      model: MODEL,
      key,
      elapsedMs: Date.now() - started,
    };
    await cacheSet(key, result);
    return Response.json({ ...result, cached: false });
  } catch (err) {
    const { status, message } = describeError(err);
    // Fall back to the closest recorded plan, labelled, rather than an empty screen.
    const rec = recordedPlanFallback(assessment.id, lessons.map((l) => l.id));
    if (rec) {
      // Coverage is computed in code, so it stays current even when the plan is not.
      return Response.json({
        ...rec.result,
        ...(rec.key !== key && { coverage, lessonIds: lessons.map((l) => l.id) }),
        recorded: meta(rec, { liveError: message, stale: rec.key !== key }),
      });
    }
    return Response.json({ error: message }, { status });
  }
}
