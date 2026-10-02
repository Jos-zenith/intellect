import { App } from "@/components/App";
import type { GradeResult } from "@/components/Grade";
import { course, drafts, pyqs, rubrics } from "@/lib/kb";
import { recordedResults } from "@/lib/recorded";

// Rendered on the server from the bundled course data, so the first paint
// already has the course, the story and the class numbers: no loading state,
// and nothing to fail if the API is cold or down.
export default function Page() {
  const results = recordedResults(drafts.filter((d) => !d.probe).map((d) => d.id)) as Record<string, GradeResult>;
  return <App kb={{ course, pyqs, rubrics, drafts }} results={results} />;
}
