// Small persistent cache for model results. Grading the same draft against the
// same rubric and lesson context returns the stored result instantly, so a
// class dashboard reloads without re-spending API calls and stays consistent.

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), ".data", "grade-cache.json");
const memory = globalThis as unknown as { __gradeCache?: Record<string, unknown> };

async function load(): Promise<Record<string, unknown>> {
  if (memory.__gradeCache) return memory.__gradeCache;
  try {
    memory.__gradeCache = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    memory.__gradeCache = {};
  }
  return memory.__gradeCache!;
}

export function cacheKey(parts: unknown) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  return (await load())[key] as T | undefined;
}

export async function cacheSet(key: string, value: unknown) {
  const store = await load();
  store[key] = value;
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(store));
  } catch {
    // Read-only filesystem: memory only.
  }
}
