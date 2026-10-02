import { addCalibration, calibrationStats, getCalibrations, getRubric, resetCalibrations } from "@/lib/kb";
import type { Calibration } from "@/lib/types";

export async function GET() {
  const list = await getCalibrations();
  return Response.json({ calibrations: list, stats: calibrationStats(list) });
}

// The teacher records the mark they actually gave for a paper the system predicted.
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Calibration>;
  const outOf = Number(body.outOf);
  const predicted = Number(body.predicted);
  const actual = Number(body.actual);
  if (!body.student?.trim() || !body.rubricId || !getRubric(body.rubricId)) {
    return Response.json({ error: "Missing student or rubric." }, { status: 400 });
  }
  if (![outOf, predicted, actual].every(Number.isFinite) || outOf <= 0 || actual < 0 || actual > outOf) {
    return Response.json({ error: `Enter the actual mark between 0 and ${outOf || "the question total"}.` }, { status: 400 });
  }
  const entry = await addCalibration({
    questionId: body.questionId ?? null,
    rubricId: body.rubricId,
    student: body.student.trim(),
    predicted,
    actual,
    outOf,
    note: body.note?.trim() ?? "",
  });
  const list = await getCalibrations();
  return Response.json({ calibration: entry, stats: calibrationStats(list) });
}

export async function DELETE() {
  await resetCalibrations();
  return Response.json({ ok: true });
}
