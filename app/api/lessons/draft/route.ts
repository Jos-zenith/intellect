import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { claude, describeError, FALLBACK, MODEL } from "@/lib/claude";
import { course, isTopicId, unitOfTopic } from "@/lib/kb";

// Turns whatever the teacher already has - rough notes, a slide outline, a
// whiteboard photo - into a structured lesson-log entry for them to confirm.

const LessonDraftSchema = z.object({
  topicIds: z.array(z.string()).describe("Syllabus topic ids actually covered, from the list given"),
  title: z.string().describe("Short lesson title"),
  summary: z.string().describe("2-4 sentences: concepts, methods and examples covered"),
  emphasis: z.string().describe("What the teacher stressed or said about assessment; empty string if nothing"),
  excludeFrom: z.array(z.enum(["IA1", "IA2", "END"])).describe("Only if the notes explicitly say a topic will not be assessed in that exam"),
  offSyllabus: z.string().describe("Anything covered that matches no syllabus topic; empty string if none"),
});

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
type MediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function POST(req: Request) {
  const body = (await req.json()) as { text?: string; images?: { mediaType: string; data: string }[] };
  const text = body.text?.trim() ?? "";
  const images = (body.images ?? []).slice(0, 3);
  if (!text && !images.length) return Response.json({ error: "Paste some notes or add a photo first." }, { status: 400 });
  if (images.some((i) => !ALLOWED.has(i.mediaType) || i.data.length > 6_000_000)) {
    return Response.json({ error: "Photos must be JPEG, PNG, WebP or GIF and under about 4 MB." }, { status: 400 });
  }

  const syllabus = course.units.map((u) => `${u.id} ${u.title}\n${u.topics.map((t) => `  ${t.id} ${t.name}`).join("\n")}`).join("\n");

  try {
    const response = await claude().beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      ...FALLBACK,
      output_config: { effort: "low", format: betaZodOutputFormat(LessonDraftSchema) },
      system: `You turn a teacher's rough class notes into a lesson-log entry for ${course.code} ${course.title}. Map what was taught onto the syllabus topic ids below - only topics clearly covered, never topics merely mentioned in passing. Keep the teacher's own wording for emphasis and assessment remarks. Do not invent content that is not in the notes.\n\nSyllabus:\n${syllabus}`,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mediaType as MediaType, data: img.data },
            })),
            { type: "text" as const, text: text ? `Teacher's notes:\n${text}` : "The class notes are in the photo(s)." },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return Response.json({ error: "The model declined this request." }, { status: 422 });
    const parsed = response.parsed_output;
    if (!parsed) return Response.json({ error: "Could not draft a lesson from these notes - try adding more detail." }, { status: 502 });

    // Topic ids are checked against the syllabus in code, and kept to one unit.
    const valid = parsed.topicIds.filter(isTopicId);
    const unit = valid.length ? unitOfTopic(valid[0]) : null;
    return Response.json({
      draft: {
        unit,
        topicIds: valid.filter((t) => unitOfTopic(t) === unit),
        title: parsed.title,
        summary: parsed.summary,
        emphasis: parsed.emphasis,
        excludeFrom: parsed.excludeFrom.filter((e) => e !== "IA1"),
      },
      offSyllabus: parsed.offSyllabus,
      droppedTopics: parsed.topicIds.filter((t) => !isTopicId(t) || unitOfTopic(t) !== unit),
    });
  } catch (err) {
    const { status, message } = describeError(err);
    return Response.json({ error: message }, { status });
  }
}
