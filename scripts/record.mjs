// Records real grader and planner runs into data/recorded/, so the demo answers
// instantly and still works if the Claude API is slow or unreachable.
//
//   npm run dev                 # in one terminal, with ANTHROPIC_API_KEY set
//   node scripts/record.mjs     # in another (optional: base URL as first arg)
//
// It resets teacher-added lessons, grades every sample draft, builds the IA2
// plan before and after the demo lesson (data/demo-lesson.json), and resets
// the lesson log again at the end. Re-run it whenever the prompts or data change.

import { readFile, writeFile } from "fs/promises";

const base = process.argv[2] ?? "http://localhost:3000";
const read = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const write = (p, data) => writeFile(new URL(`../${p}`, import.meta.url), JSON.stringify(data, null, 1) + "\n");

const drafts = await read("data/drafts.json");
const demoLesson = await read("data/demo-lesson.json");
const course = await read("data/course.json");
const recordedAt = new Date().toISOString();

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`${path}: ${data.error ?? res.status}`);
  if (data.recorded) throw new Error(`${path}: got a recorded fallback, not a live result (${data.recorded.liveError ?? "?"})`);
  return data;
}

// Per-request state that should not be frozen into a recording.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const strip = ({ calibration, cached, recorded, ...rest }) => rest;

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

const gradeOf = (d, extra = {}) => call("POST", "/api/grade", { questionId: d.questionId, draft: d.text, ...extra });

async function gradeAll(label) {
  const t = Date.now();
  const rows = await inBatches(drafts, 4, async (d) => {
    const r = await gradeOf(d, { live: true });
    console.log(`  ${label} ${d.id}: ${r.score}/${r.outOf} (${r.relevance?.verdict}) in ${Math.round(r.elapsedMs / 1000)} s`);
    return { draftId: d.id, key: r.key, recordedAt, origin: "recorded", result: strip(r) };
  });
  console.log(`  ${rows.length} grades in ${Math.round((Date.now() - t) / 1000)} s`);
  return rows;
}

async function plan(name) {
  const r = await call("POST", "/api/plan", { assessmentId: "IA2", asOf: course.today, live: true });
  console.log(`  plan "${name}": ${r.practiceTest.length} questions, ${r.check.outOfScope} out of scope, ${Math.round(r.elapsedMs / 1000)} s`);
  return { name, key: r.key, assessmentId: "IA2", lessonIds: r.lessonIds, recordedAt, origin: "recorded", result: strip(r) };
}

console.log(`Recording against ${base}`);
await call("DELETE", "/api/lessons");
try {
  console.log("Grading sample drafts");
  const grades = await gradeAll("base");
  console.log("Building IA2 plan before the demo lesson");
  const plans = [await plan("before demo lesson")];

  await call("POST", "/api/lessons", demoLesson);
  console.log("Building IA2 plan after the demo lesson");
  plans.push(await plan("after demo lesson"));

  // The new lesson can change what retrieval puts in front of the grader;
  // record those contexts too so grading stays instant after the demo edit.
  const changed = [];
  for (const d of drafts) {
    const { key } = await call("POST", "/api/grade", { questionId: d.questionId, draft: d.text, keyOnly: true });
    if (!grades.some((g) => g.key === key)) changed.push(d);
  }
  if (changed.length) {
    console.log(`Re-grading ${changed.length} draft(s) whose context changed with the demo lesson`);
    grades.push(
      ...(await inBatches(changed, 4, async (d) => {
        const r = await gradeOf(d, { live: true });
        console.log(`  after-lesson ${d.id}: ${r.score}/${r.outOf}`);
        return { draftId: d.id, key: r.key, recordedAt, origin: "recorded", result: strip(r) };
      })),
    );
  }

  await write("data/recorded/grades.json", grades);
  await write("data/recorded/plans.json", plans);
  console.log(`Wrote ${grades.length} grades and ${plans.length} plans to data/recorded/`);
} finally {
  await call("DELETE", "/api/lessons");
}
