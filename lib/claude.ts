import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | undefined;

// Created lazily so a missing key surfaces as a request error, not a crash at
// import time. Reads ANTHROPIC_API_KEY from docs/.env.local.
export function claude() {
  cached ??= new Anthropic();
  return cached;
}

export const MODEL = "claude-opus-5-5";

// If a safety classifier declines a request, the API re-runs it on the
// model Anthropic recommends for that refusal category instead of failing.
export const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

const KEY_HINT = "Add ANTHROPIC_API_KEY to docs/.env.local and restart `npm run dev`.";

// The API's own message, without the status code and JSON envelope.
function apiMessage(err: InstanceType<typeof Anthropic.APIError>) {
  const body = err.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? err.message;
}

export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 401, message: `Claude API key is invalid. ${KEY_HINT}` };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Rate limited by the Claude API - wait a few seconds and try again." };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `Claude API rejected the request: ${apiMessage(err)}` };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: err.status ?? 502, message: `Claude API error ${err.status ?? ""}: ${apiMessage(err)}` };
  }
  if (err instanceof Anthropic.AnthropicError) {
    // Client-side SDK error, most often a missing key.
    return { status: 500, message: `${err.message} ${KEY_HINT}` };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (!process.env.ANTHROPIC_API_KEY) return { status: 500, message: `No Claude API key configured. ${KEY_HINT}` };
  return { status: 500, message };
}
