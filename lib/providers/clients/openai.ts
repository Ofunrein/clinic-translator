// Track D (dev provider). Single-key OpenAI wiring used by the dev stack so
// the app runs end-to-end without AWS/Google/Deepgram credentials. STT is
// chunked-batch (Whisper has no native streaming API; the route buffers ~2s
// of audio per POST). Translate/Suggest are JSON-mode chat completions on
// gpt-4o-mini, TTS is `tts-1` with the `nova` voice.
//
// All calls go through global `fetch`; we deliberately do NOT depend on the
// `openai` npm package so the Edge runtime stays slim and bundling stays
// dependency-free.
//
// No PHI is ever logged from this file — errors carry status + message only.

import { STTError, SuggestError, TTSError, TranslateError } from "@/lib/api/errors";
import {
  buildSuggestSystemPrompt,
  type ClinicConfig,
} from "@/lib/clinic-prompts";
import type { Dialect } from "@/lib/medical-glossary";
import type { SuggestionResult, SuggestTurn } from "@/lib/anthropic";

const OPENAI_BASE = "https://api.openai.com/v1";

// ---------------------------------------------------------------------------
// Test seam — lets integration tests swap a fake fetch without monkey-patching
// the global. Pattern mirrors B2's `__setBedrockClientForTest`.
// ---------------------------------------------------------------------------
export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

let _fetchOverride: FetchLike | null = null;
export function __setOpenaiFetchForTest(f: FetchLike | null): void {
  _fetchOverride = f;
}

function getFetch(): FetchLike {
  if (_fetchOverride) return _fetchOverride;
  return ((input: string, init: RequestInit) =>
    fetch(input, init)) as FetchLike;
}

function getApiKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k || k.length === 0) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return k;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// STT — Whisper (one-shot, chunked-batch from the route).
// DEV_STT_OPENAI_CHUNKED: Whisper has no streaming endpoint. The caller
// (app/api/stt/route.ts) buffers ~2 seconds of 16 kHz PCM, wraps each window
// in a minimal WAV header, and POSTs here. "Streaming" partials become
// per-window finals. Acceptable for the dev stack only.
// ---------------------------------------------------------------------------

export interface TranscribeArgs {
  audioBuffer: Buffer;
  lang: "es" | "en";
}

export interface TranscribeResult {
  transcript: string;
  isFinal: true;
  confidence?: number;
}

interface WhisperVerboseJson {
  text?: string;
  language?: string;
  segments?: Array<{ avg_logprob?: number; no_speech_prob?: number }>;
}

/** Map Whisper's segment avg_logprob (≤0, higher better) to a 0-1 score. */
function avgLogprobToConfidence(avg: number): number {
  // exp(avg_logprob) is the geometric mean of token probabilities — already 0-1.
  const score = Math.exp(avg);
  if (Number.isNaN(score)) return 0;
  return Math.max(0, Math.min(1, score));
}

function buildMultipartBody(
  audio: Buffer,
  lang: "es" | "en",
): { body: Buffer; contentType: string } {
  const boundary = `----openaiform${Math.random().toString(36).slice(2)}`;
  const eol = "\r\n";
  const parts: Buffer[] = [];

  const field = (name: string, value: string): Buffer =>
    Buffer.from(
      `--${boundary}${eol}` +
        `Content-Disposition: form-data; name="${name}"${eol}${eol}` +
        `${value}${eol}`,
      "utf8",
    );

  parts.push(field("model", "whisper-1"));
  parts.push(field("language", lang));
  parts.push(field("response_format", "verbose_json"));
  parts.push(field("temperature", "0"));

  // Audio file part — Whisper accepts wav/mp3/m4a/webm/ogg/mp4. The route
  // posts WAV-wrapped PCM frames; the extension just needs to be a hint.
  parts.push(
    Buffer.from(
      `--${boundary}${eol}` +
        `Content-Disposition: form-data; name="file"; filename="audio.wav"${eol}` +
        `Content-Type: audio/wav${eol}${eol}`,
      "utf8",
    ),
  );
  parts.push(audio);
  parts.push(Buffer.from(eol, "utf8"));
  parts.push(Buffer.from(`--${boundary}--${eol}`, "utf8"));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export async function transcribeOpenai(
  args: TranscribeArgs,
): Promise<TranscribeResult> {
  if (!args.audioBuffer || args.audioBuffer.length === 0) {
    throw new STTError("empty audio buffer", { retryable: false });
  }
  const key = getApiKey();
  const { body, contentType } = buildMultipartBody(args.audioBuffer, args.lang);

  let res: Response;
  try {
    res = await getFetch()(`${OPENAI_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": contentType,
      },
      // Buffer is an accepted RequestInit.body shape on Node/Edge runtimes.
      body: body as unknown as BodyInit,
    });
  } catch (err) {
    throw new STTError("openai whisper transport failed", {
      retryable: true,
      cause: err,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new STTError(`whisper upstream ${res.status}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status === 429 ? 429 : 502,
      cause: text.slice(0, 256),
    });
  }

  let parsed: WhisperVerboseJson;
  try {
    parsed = (await res.json()) as WhisperVerboseJson;
  } catch (err) {
    throw new STTError("whisper returned non-JSON body", {
      retryable: true,
      cause: err,
    });
  }

  const transcript = typeof parsed.text === "string" ? parsed.text.trim() : "";
  let confidence: number | undefined;
  const segs = parsed.segments ?? [];
  if (segs.length > 0) {
    const logprobs = segs
      .map((s) => (typeof s.avg_logprob === "number" ? s.avg_logprob : null))
      .filter((n): n is number => n !== null);
    if (logprobs.length > 0) {
      const mean = logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
      confidence = avgLogprobToConfidence(mean);
    }
  }

  return { transcript, isFinal: true, confidence };
}

// ---------------------------------------------------------------------------
// Translate — gpt-4o-mini chat completion with JSON mode.
// Matches the `translate()` contract from `lib/anthropic.ts`.
// ---------------------------------------------------------------------------

export interface TranslateOpenaiArgs {
  text: string;
  src: "es" | "en";
  dst: "es" | "en";
  glossaryHits?: { en: string; es: string }[];
}

export interface TranslateOpenaiResult {
  translation: string;
  glossary_hits: { en: string; es: string }[];
}

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

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
}

function buildTranslateUserPrompt(args: TranslateOpenaiArgs): string {
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

export async function translateOpenai(
  args: TranslateOpenaiArgs,
): Promise<TranslateOpenaiResult> {
  const key = getApiKey();
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: TRANSLATE_SYSTEM },
    { role: "user", content: buildTranslateUserPrompt(args) },
  ];

  let res: Response;
  try {
    res = await getFetch()(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages,
      }),
    });
  } catch (err) {
    throw new TranslateError("openai translate transport failed", {
      retryable: true,
      cause: err,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TranslateError(`openai translate ${res.status}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status === 429 ? 429 : 502,
      cause: text.slice(0, 256),
    });
  }

  let parsed: ChatCompletionResponse;
  try {
    parsed = (await res.json()) as ChatCompletionResponse;
  } catch (err) {
    throw new TranslateError("openai translate non-JSON body", {
      retryable: true,
      cause: err,
    });
  }

  const raw = parsed.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new TranslateError("empty translation from openai", {
      retryable: true,
    });
  }

  let translation = "";
  try {
    const obj = JSON.parse(raw) as { translation?: unknown };
    if (typeof obj.translation === "string") translation = obj.translation;
  } catch {
    // JSON mode usually guarantees valid JSON; fall back to raw text just in case.
    translation = raw.trim();
  }
  if (!translation) {
    throw new TranslateError("translation field missing in openai output", {
      retryable: true,
    });
  }

  return { translation, glossary_hits: args.glossaryHits ?? [] };
}

// ---------------------------------------------------------------------------
// TTS — tts-1 / nova by default.
// ---------------------------------------------------------------------------

export interface SynthesizeOpenaiArgs {
  text: string;
  voice?: string;
  model?: "tts-1" | "tts-1-hd";
}

export async function synthesizeOpenai(
  args: SynthesizeOpenaiArgs,
): Promise<Buffer> {
  if (!args.text || args.text.length === 0) {
    throw new TTSError("empty text", { retryable: false });
  }
  const key = getApiKey();
  const voice = args.voice ?? "nova";
  const model = args.model ?? "tts-1";

  let res: Response;
  try {
    res = await getFetch()(`${OPENAI_BASE}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input: args.text,
        response_format: "mp3",
      }),
    });
  } catch (err) {
    throw new TTSError("openai tts transport failed", {
      retryable: true,
      cause: err,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TTSError(`openai tts ${res.status}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status === 429 ? 429 : 502,
      cause: text.slice(0, 256),
    });
  }

  const ab = await res.arrayBuffer();
  if (ab.byteLength === 0) {
    throw new TTSError("openai tts returned empty audio", { retryable: true });
  }
  return Buffer.from(ab);
}

// ---------------------------------------------------------------------------
// Suggest — streaming chat completion (SSE).
// Yields incremental `{token}` events as text deltas arrive, then a single
// `{final}` event with the parsed `SuggestionResult` envelope.
// ---------------------------------------------------------------------------

export interface SuggestOpenaiArgs {
  transcript: SuggestTurn[];
  clinicContext: ClinicConfig;
  dialect: Dialect;
}

export type SuggestOpenaiEvent =
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
    throw new SuggestError("openai suggest returned non-JSON", {
      retryable: true,
      cause: err,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new SuggestError("openai suggest was not an object", {
      retryable: true,
    });
  }
  const obj = parsed as Record<string, unknown>;
  const suggestion = typeof obj.suggestion === "string" ? obj.suggestion : "";
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
  const escalate = obj.escalate === true;
  const confidence = clampConfidence(obj.confidence);
  if (!suggestion) {
    throw new SuggestError("openai suggest missing suggestion field", {
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

interface SseDelta {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

/** Pull complete `data: ...\n\n` events out of a rolling buffer. */
function drainSseEvents(buf: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buf;
  // SSE events end with a blank line. Use \n\n as canonical; tolerate \r\n.
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    const chunk = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    // Each event line begins with `data: `. There may be multiple per chunk.
    for (const line of chunk.split("\n")) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed.startsWith("data:")) {
        events.push(trimmed.slice(5).trimStart());
      }
    }
  }
  return { events, rest };
}

export async function* suggestReplyOpenai(
  args: SuggestOpenaiArgs,
): AsyncIterable<SuggestOpenaiEvent> {
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
    res = await getFetch()(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 512,
        response_format: { type: "json_object" },
        stream: true,
        messages,
      }),
    });
  } catch (err) {
    throw new SuggestError("openai suggest transport failed", {
      retryable: true,
      cause: err,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SuggestError(`openai suggest ${res.status}`, {
      retryable: isRetryableStatus(res.status),
      status: res.status === 429 ? 429 : 502,
      cause: text.slice(0, 256),
    });
  }

  const body = res.body;
  if (!body) {
    throw new SuggestError("openai suggest body missing", { retryable: true });
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
        // Flush whatever remains as a final pseudo-boundary.
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
          // Skip malformed chunks; final parse below operates on the tail.
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
    throw new SuggestError("openai suggest stream interrupted", {
      retryable: true,
      cause: err,
    });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }

  const final = parseSuggestion(assembled);
  yield { final };
}
