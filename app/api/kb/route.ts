import { course, drafts, getSource, pyqs, rubrics, search } from "@/lib/kb";

// GET /api/kb            -> course, questions, rubrics and sample drafts for the UI
// GET /api/kb?source=ID  -> one knowledge-base item, for citation chips
// GET /api/kb?q=...      -> raw retrieval hits, for inspecting what the agent sees
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q");
  if (q) {
    const hits = await search(q, { k: 8 });
    return Response.json({ hits: hits.map(({ id, score, title }) => ({ id, score: Number(score.toFixed(2)), title })) });
  }
  const id = params.get("source");
  if (id) {
    const source = await getSource(id);
    return source ? Response.json({ source }) : Response.json({ error: `No source ${id}` }, { status: 404 });
  }
  return Response.json({
    course,
    pyqs,
    rubrics,
    drafts,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
}
