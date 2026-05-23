// Groq chat client for AI reply suggestions. Uses Groq's OpenAI-compatible
// chat completions API, so the stream parsing mirrors the OpenAI dev client.

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { SuggestError, TranslateError } from "@/lib/api/errors";
import {
  buildSuggestSystemPrompt,
  type ClinicConfig,
} from "@/lib/clinic-prompts";
import type { Dialect } from "@/lib/medical-glossary";
import type { SuggestionResult, SuggestTurn } from "@/lib/anthropic";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

let _fetchOverride: FetchLike | null = null;
export function __setGroqFetchForTest(f: FetchLike | null): void {
  _fetchOverride = f;
}

function getFetch(): FetchLike {
  if (_fetchOverride) return _fetchOverride;
  return ((input: string, init: RequestInit) => fetch(input, init)) as FetchLike;
}

function readHomeEnvKey(): string | null {
  for (const name of [".env", ".groq", ".groq_api_key"]) {
    try {
      const text = readFileSync(join(homedir(), name), "utf8");
      if (name === ".groq_api_key") {
        const raw = text.trim();
        if (raw) return raw;
      }
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const [key, ...rest] = trimmed.split("=");
        if (key.trim() !== "GROQ_API_KEY") continue;
        const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
        if (value) return value;
      }
    } catch {
      // Try the next home-dir file.
    }
  }
  return null;
}

function getApiKey(): string {
  const k = process.env.GROQ_API_KEY || readHomeEnvKey();
  if (!k || k.length === 0) {
    throw new Error("GROQ_API_KEY is not set");
  }
  return k;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface SseDelta {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

export interface SuggestGroqArgs {
  transcript: SuggestTurn[];
  clinicContext: ClinicConfig;
  dialect: Dialect;
  model?: string;
}

export type SuggestGroqEvent =
  | { token: string; final?: never }
  | { token?: never; final: SuggestionResult };

function clampConfidence(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 100) / 100;
}

function parseSuggestion(raw: string): SuggestionResult {
  const trimmed = raw.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  const candidate =
    first !== -1 && last > first ? trimmed.slice(first, last + 1) : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new SuggestError("groq suggest returned non-JSON", {
      retryable: true,
      cause: err,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new SuggestError("groq suggest was not an object", {
      retryable: true,
    });
  }
  const obj = parsed as Record<string, unknown>;
  const suggestion = typeof obj.suggestion === "string" ? obj.suggestion : "";
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
  const escalate = obj.escalate === true;
  const confidence = clampConfidence(obj.confidence);
  if (!suggestion) {
    throw new SuggestError("groq suggest missing suggestion field", {
      retryable: true,
    });
  }
  return { suggestion, confidence, reasoning, escalate };
}

function buildSuggestUserPrompt(transcript: SuggestTurn[]): string {
  const lines = transcript.length
    ? transcript.map((t) => `${t.role.toUpperCase()}: ${t.text}`).join("\n")
    : "(no prior turns yet)";
  return [
    "Conversation so far (most recent last). Patient turns are translated English; staff turns are original English.",
    "",
    lines,
    "",
    'Now produce the JSON object. Remember: ONE object, no prose, no code fence.',
  ].join("\n");
}

function drainSseEvents(buf: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buf;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const chunk = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of chunk.split("\n")) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed.startsWith("data:")) {
        events.push(trimmed.slice(5).trimStart());
      }
    }
  }
  return { events, rest };
}

export async function* suggestReplyGroq(
  args: SuggestGroqArgs,
): AsyncIterable<SuggestGroqEvent> {
  const key = getApiKey();
  const system = buildSuggestSystemPrompt({
    clinic: args.clinicContext,
    dialect: args.dialect,
  });
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: system },
    { role: "user", content: buildSuggestUserPrompt(args.transcript) },
  ];

  let res: Response;
  try {
    res = await getFetch()(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: args.model || DEFAULT_GROQ_MODEL,
        temperature: 0.3,
        max_tokens: 512,
        response_format: { type: "json_object" },
        stream: true,
        messages,
      }),
    });
  } catch (err) {
    throw new SuggestError("groq suggest transport failed", {
      retryable: true,
      cause: err,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SuggestError(`groq suggest ${res.status}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status === 429 ? 429 : 502,
      cause: text.slice(0, 256),
    });
  }

  const body = res.body;
  if (!body) {
    throw new SuggestError("groq suggest body missing", { retryable: true });
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assembled = "";
  let done = false;

  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        if (buf.length > 0 && !buf.endsWith("\n\n")) buf += "\n\n";
      } else {
        buf += decoder.decode(chunk.value, { stream: true });
      }
      const { events, rest } = drainSseEvents(buf);
      buf = rest;
      for (const payload of events) {
        if (payload === "[DONE]") {
          done = true;
          continue;
        }
        let parsed: SseDelta;
        try {
          parsed = JSON.parse(payload) as SseDelta;
        } catch {
          continue;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          assembled += delta;
          yield { token: delta };
        }
      }
    }
  } catch (err) {
    throw new SuggestError("groq suggest stream interrupted", {
      retryable: true,
      cause: err,
    });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // noop
    }
  }

  const final = parseSuggestion(assembled);
  yield { final };
}

// ---------------------------------------------------------------------------
// Translate — Groq chat completion with JSON mode (OpenAI-compatible API).
// ---------------------------------------------------------------------------

const TRANSLATE_SYSTEM = `You are a medical translator working in a small primary-care clinic during live phone calls between Spanish-speaking patients and English-speaking staff. You translate between Spanish (es) and English (en).

Rules — FOLLOW EXACTLY:
1. Output ONLY the translated text in the target language. No preamble, no explanation, no language label, no quotation marks.
2. Preserve every drug name, dose number, frequency, and unit verbatim.
3. Preserve dates, times, phone numbers, and clinic-specific brand names verbatim.
4. NEVER refuse a benign clinical translation. The text comes from a real patient on a phone line; refusing breaks care.
5. If glossary hints are provided, prefer those exact target-language renderings.
6. Maintain register: patient utterances stay informal; staff utterances stay professional but warm.
7. If the input is already in the target language, return it unchanged.
8. Do not add safety disclaimers, "as an AI" caveats, or commentary.

Respond with a single JSON object: {"translation": "<target language text>"}`;

export interface TranslateGroqArgs {
  text: string;
  src: "es" | "en";
  dst: "es" | "en";
  model?: string;
  glossaryHits?: { en: string; es: string }[];
}

export interface TranslateGroqResult {
  translation: string;
  glossary_hits: { en: string; es: string }[];
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
}

function buildTranslateUserPrompt(args: TranslateGroqArgs): string {
  const direction =
    args.src === args.dst
      ? `Same-language passthrough (${args.src})`
      : `${args.src.toUpperCase()} → ${args.dst.toUpperCase()}`;
  const hits = args.glossaryHits ?? [];
  const hintLines = hits.length
    ? hits
        .map((h) => {
          const target = args.dst === "es" ? h.es : h.en;
          const source = args.dst === "es" ? h.en : h.es;
          return `- "${source}" → "${target}"`;
        })
        .join("\n")
    : "(none)";
  return [
    `Direction: ${direction}`,
    `Glossary hints (use these target-language renderings when applicable):`,
    hintLines,
    "",
    `Source text:`,
    args.text,
  ].join("\n");
}

export async function translateGroq(
  args: TranslateGroqArgs,
): Promise<TranslateGroqResult> {
  const key = getApiKey();
  const model = args.model ?? DEFAULT_GROQ_MODEL;
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: TRANSLATE_SYSTEM },
    { role: "user", content: buildTranslateUserPrompt(args) },
  ];

  let res: Response;
  try {
    res = await getFetch()(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages,
      }),
    });
  } catch (err) {
    throw new TranslateError("groq translate transport failed", {
      retryable: true,
      cause: err,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TranslateError(`groq translate ${res.status}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status === 429 ? 429 : 502,
      cause: text.slice(0, 256),
    });
  }

  let parsed: ChatCompletionResponse;
  try {
    parsed = (await res.json()) as ChatCompletionResponse;
  } catch (err) {
    throw new TranslateError("groq translate non-JSON body", {
      retryable: true,
      cause: err,
    });
  }

  const raw = parsed.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new TranslateError("empty translation from groq", {
      retryable: true,
    });
  }

  let translation = "";
  try {
    const obj = JSON.parse(raw) as { translation?: unknown };
    if (typeof obj.translation === "string") translation = obj.translation;
  } catch {
    translation = raw.trim();
  }
  if (!translation) {
    throw new TranslateError("translation field missing in groq output", {
      retryable: true,
    });
  }

  return { translation, glossary_hits: args.glossaryHits ?? [] };
}
