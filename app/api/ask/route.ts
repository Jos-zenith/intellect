import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { claude, describeError, FALLBACK, MODEL } from "@/lib/claude";
import { course, coverageFor, getAssessment, getLessons, getSources, search } from "@/lib/kb";
import type { AssessmentId } from "@/lib/types";

const SYSTEM = `You are Intellect, the study copilot for ${course.code} ${course.title} at ${course.college}, taught by ${course.faculty}.

Your job is to close the gap between what was taught, what is studied and how it is graded. Students ask what to study, how to answer, why they lost marks, and what will be tested.

Ground every factual claim about this course in the knowledge base. Use the tools before answering anything course-specific: the syllabus, the faculty's lesson log (what was actually taught, on which date, and what the professor emphasised), previous year questions with answer keys and examiner notes, the college rubrics, and the faculty's notes. Prefer the lesson log and faculty notes over generic textbook knowledge, because they reflect how this professor teaches and marks.

Cite sources inline with their ids in square brackets, for example [LES-0812] or [PYQ-25-IA1-B2]. Only cite ids that a tool returned. When something is in the syllabus but has not been taught yet, or the faculty has excluded it from an assessment, say so plainly. If the knowledge base does not cover a question, say that and give general engineering guidance clearly labelled as such.

Write for a student the night before an exam: direct, concrete, short paragraphs or tight lists. When you explain a concept, show how to apply it to a concrete product or campus scenario, because that is where the marks are. When you recommend what to study, rank by marks at stake.`;

const UNIT = z.enum(["U1", "U2", "U3", "U4", "U5"]);
const TYPES = z.enum(["syllabus", "lesson", "pyq", "rubric", "note"]);

class TruncatedToolInput extends Error {}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: ChatTurn[] };
  if (!messages?.length || messages.at(-1)?.role !== "user") {
    return Response.json({ error: "Send a conversation ending with a user message." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const seenIds = new Set<string>();
      const remember = (ids: string[]) => ids.forEach((id) => seenIds.add(id));

      const tools = [
        betaZodTool({
          name: "search_knowledge_base",
          description:
            "Keyword search over the course knowledge base: syllabus units, the faculty's dated lesson log, previous year questions (with answer keys and examiner notes), rubrics and faculty notes. Returns the best matching items with their ids. Call it several times with different phrasings or filters when the first results are thin.",
          inputSchema: z.object({
            query: z.string().describe("Keywords, e.g. 'thermal stress compound bar common mistakes'"),
            types: z.array(TYPES).optional().describe("Restrict to these source types"),
            unit: UNIT.optional().describe("Restrict to one syllabus unit"),
          }),
          run: async ({ query, types, unit }) => {
            const hits = await search(query, { types, unit, k: 6 });
            remember(hits.map((h) => h.id));
            emit({ type: "tool_result", name: "search_knowledge_base", ids: hits.map((h) => h.id) });
            if (!hits.length) return "No matches. Try broader keywords or remove filters.";
            return JSON.stringify(hits.map(({ id, type, title, text }) => ({ id, type, title, text })));
          },
        }),
        betaZodTool({
          name: "get_exam_coverage",
          description:
            "For an assessment (IA1, IA2 or END), returns its date, question pattern and every syllabus topic in its units with status: taught (with the lesson ids), excluded by the faculty, or not yet taught - plus how many previous-year marks each topic has carried. Use it for 'what is coming in the exam' and 'what should I study' questions.",
          inputSchema: z.object({ assessment: z.enum(["IA1", "IA2", "END"]) }),
          run: async ({ assessment }) => {
            const a = getAssessment(assessment as AssessmentId);
            const coverage = await coverageFor(a.id, course.today);
            remember(coverage.flatMap((c) => [...c.lessonIds, ...c.pyqIds]));
            emit({ type: "tool_result", name: "get_exam_coverage", ids: [a.id] });
            return JSON.stringify({ today: course.today, assessment: a, coverage });
          },
        }),
        betaZodTool({
          name: "get_lesson_log",
          description:
            "Returns the faculty's lesson log entries (what was taught in class, on which date, with the professor's emphasis), optionally filtered by date range and unit.",
          inputSchema: z.object({
            from: z.string().optional().describe("ISO date, inclusive"),
            to: z.string().optional().describe("ISO date, inclusive"),
            unit: UNIT.optional(),
          }),
          run: async ({ from, to, unit }) => {
            const lessons = (await getLessons()).filter(
              (l) => (!from || l.date >= from) && (!to || l.date <= to) && (!unit || l.unit === unit),
            );
            remember(lessons.map((l) => l.id));
            emit({ type: "tool_result", name: "get_lesson_log", ids: lessons.map((l) => l.id) });
            return JSON.stringify(lessons);
          },
        }),
      ].map((tool) => ({ ...tool, eager_input_streaming: true }));

      const params = {
        model: MODEL,
        max_tokens: 64000,
        ...FALLBACK,
        output_config: { effort: "medium" as const },
        system: `${SYSTEM}\n\nToday is ${course.today}.`,
        tools,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true as const,
      };

      try {
        let runner = claude().beta.messages.toolRunner(params);
        // Re-issue a turn whose tool input could not be parsed (max 2 times).
        for (let attempt = 0; ; attempt++) {
          try {
            for await (const messageStream of runner) {
              for await (const event of messageStream) {
                if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
                  emit({ type: "tool_start", name: event.content_block.name });
                } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                  emit({ type: "text", delta: event.delta.text });
                }
              }
              const message = await messageStream.finalMessage();
              attempt = 0;
              for (const block of message.content) {
                if (block.type === "tool_use") emit({ type: "tool", name: block.name, input: block.input });
              }
              const hasToolUse = message.content.some((b) => b.type === "tool_use");
              if (message.stop_reason === "max_tokens" && hasToolUse) {
                throw new TruncatedToolInput("The answer was cut off mid tool call. Try a narrower question.");
              }
              if (message.stop_reason === "refusal") {
                emit({ type: "text", delta: "\n\n_The model declined to answer this request._" });
                break;
              }
            }
            break;
          } catch (err) {
            if (err instanceof Anthropic.APIError || err instanceof TruncatedToolInput || attempt >= 2) throw err;
            runner = claude().beta.messages.toolRunner({ ...runner.params, stream: true });
          }
        }

        const sources = (await getSources())
          .filter((s) => seenIds.has(s.id))
          .map(({ id, type, title, text }) => ({ id, type, title, text }));
        emit({ type: "sources", sources });
        emit({ type: "done" });
      } catch (err) {
        emit({ type: "error", message: describeError(err).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
