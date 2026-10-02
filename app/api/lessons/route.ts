import { addLesson, course, getLessons, isTopicId, resetTeacherLessons, unitOfTopic } from "@/lib/kb";
import type { AssessmentId, Lesson } from "@/lib/types";

export async function GET() {
  return Response.json({ lessons: await getLessons() });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Lesson>;
  const topicIds = (body.topicIds ?? []).filter(isTopicId);
  const title = body.title?.trim();
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return Response.json({ error: "Give the class date as YYYY-MM-DD." }, { status: 400 });
  }
  if (!topicIds.length || !title) {
    return Response.json({ error: "A lesson needs a title and at least one syllabus topic." }, { status: 400 });
  }
  const unit = unitOfTopic(topicIds[0]);
  const validExams = new Set(course.assessments.map((a) => a.id));
  const lesson = await addLesson({
    date: body.date,
    unit,
    topicIds,
    title,
    summary: body.summary?.trim() ?? "",
    emphasis: body.emphasis?.trim() ?? "",
    excludeFrom: (body.excludeFrom ?? []).filter((e): e is AssessmentId => validExams.has(e)),
  });
  return Response.json({ lesson });
}

export async function DELETE() {
  await resetTeacherLessons();
  return Response.json({ ok: true });
}
