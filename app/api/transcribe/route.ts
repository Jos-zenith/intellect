import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { claude, describeError, FALLBACK, MODEL } from "@/lib/claude";
import { course, getPyq } from "@/lib/kb";

const TranscriptSchema = z.object({
  transcript: z
    .string()
    .describe(
      "The full answer in reading order, exactly as written (keep the student's own mistakes). Each diagram appears inline as [Diagram: type - every label, arrow and scenario-specific entry as drawn]. Unreadable words are written as [illegible].",
    ),
  diagrams: z.array(
    z.object({
      label: z.string().describe("Short name, e.g. 'Empathy map' or 'Wireflow, screens 1-4'"),
      description: z.string().describe("What is drawn: structure, labels, arrows, content"),
      confidence: z.enum(["high", "medium", "low"]).describe("How sure you are that the description matches the drawing"),
    }),
  ),
  unclear: z.array(z.object({ text: z.string(), reason: z.string() })).describe("Words or parts you could not read with confidence"),
  legibility: z.enum(["high", "medium", "low"]),
});

const SYSTEM = `You transcribe handwritten exam answers for ${course.code} ${course.title} so they can be graded. You are a careful transcriber, not a grader: never correct, complete or improve the student's answer, and never guess a word you cannot read. Describe diagrams faithfully - their structure, every label and arrow, and whether the content is specific to the question's scenario or a generic template. Flag anything uncertain so a human can check it.`;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES = 4;
const MAX_BASE64 = 6_000_000;

type MediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export async function POST(req: Request) {
  const body = (await req.json()) as { images?: { mediaType: string; data: string }[]; questionId?: string; questionText?: string };
  const images = body.images ?? [];
  if (!images.length) return Response.json({ error: "Add at least one photo of your answer." }, { status: 400 });
  if (images.length > MAX_IMAGES) return Response.json({ error: `Up to ${MAX_IMAGES} pages at a time.` }, { status: 400 });
  if (images.some((i) => !ALLOWED.has(i.mediaType) || !i.data || i.data.length > MAX_BASE64)) {
    return Response.json({ error: "Photos must be JPEG, PNG, WebP or GIF and under about 4 MB each." }, { status: 400 });
  }
  const question = (body.questionId && getPyq(body.questionId)?.question) || body.questionText || "";

  try {
    const response = await claude().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "medium", format: betaZodOutputFormat(TranscriptSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((img) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: img.mediaType as MediaType, data: img.data },
            })),
            {
              type: "text" as const,
              text: `${question ? `The question being answered:\n${question}\n\n` : ""}Transcribe these ${images.length} page(s) of the student's handwritten answer, in order.`,
            },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return Response.json({ error: "The model declined to transcribe these images." }, { status: 422 });
    }
    const parsed = response.parsed_output;
    if (!parsed) return Response.json({ error: "Could not read the transcription - try clearer photos." }, { status: 502 });
    return Response.json(parsed);
  } catch (err) {
    const { status, message } = describeError(err);
    return Response.json({ error: message }, { status });
  }
}
