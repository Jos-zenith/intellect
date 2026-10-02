// Parses a rubric pasted as plain text, one criterion per line:
//   Scenario and users (2): names the users and their constraints
//   - Diagram (max 3 marks) - labelled, scenario-specific
// Shared by the client (live preview) and the grade route (validation).

export interface PastedCriterion {
  name: string;
  max: number;
  descriptor: string;
}

export interface ParsedRubric {
  criteria: PastedCriterion[];
  /** Non-empty lines that did not look like a criterion. */
  skipped: string[];
  total: number;
}

const LINE = /^(.+?)\s*\(\s*(?:max\.?\s*)?(\d+(?:\.\d+)?)\s*(?:marks?|m)?\s*\)\s*(?:[:\-–—]\s*(.*))?$/i;

export function parseRubricText(text: string): ParsedRubric {
  const criteria: PastedCriterion[] = [];
  const skipped: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line) continue;
    const m = line.match(LINE);
    const max = m ? Number(m[2]) : NaN;
    if (m && max > 0 && max <= 50) criteria.push({ name: m[1].trim(), max, descriptor: (m[3] ?? "").trim() });
    else skipped.push(line);
  }
  return { criteria, skipped, total: criteria.reduce((s, c) => s + c.max, 0) };
}

export function rubricTextProblem(parsed: ParsedRubric): string | null {
  if (!parsed.criteria.length) return "No criteria found. Write one per line, like: Diagram (2): labelled and specific to the scenario";
  if (parsed.criteria.length > 10) return "Keep it to 10 criteria or fewer.";
  if (parsed.total > 100) return "The criteria add up to more than 100 marks.";
  return null;
}
