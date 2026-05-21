// Track B2. AWS Bedrock Claude Sonnet 4.6 client wrapper for /api/translate.
// Spec §4.2, §5.1 step 5, §7 (translate refusal handling).
//
// Auth: standard AWS SDK provider chain (env, IAM role, AWS_PROFILE).
// Region: process.env.BEDROCK_REGION (default us-east-1).
// Model:  process.env.BEDROCK_MODEL_ID (default anthropic.claude-sonnet-4-6-v1:0).

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { SuggestError, TranslateError } from "./api/errors";
import { findGlossaryHits, type Dialect, type GlossaryHit } from "./medical-glossary";
import {
  buildSuggestSystemPrompt,
  type ClinicConfig,
} from "./clinic-prompts";

const DEFAULT_MODEL_ID = "anthropic.claude-sonnet-4-6-v1:0";
const DEFAULT_REGION = "us-east-1";

let _client: BedrockRuntimeClient | null = null;
function client(): BedrockRuntimeClient {
  if (_client) return _client;
  _client = new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? DEFAULT_REGION,
  });
  return _client;
}

export interface TranslateArgs {
  text: string;
  src: "es" | "en";
  dst: "es" | "en";
  dialect?: Dialect;
  glossaryHits?: GlossaryHit[];
}

export interface GlossaryHitOut {
  en: string;
  es: string;
  category?: string;
}

export interface TranslateResult {
  translation: string;
  glossary_hits: GlossaryHitOut[];
}

// Test-seam: allow injecting a Bedrock-like client (used by msw integration test).
export interface BedrockLike {
  send: (cmd: InvokeModelCommand) => Promise<{
    body?: Uint8Array | { transformToString: () => Promise<string> };
  }>;
}
let _override: BedrockLike | null = null;
export function __setBedrockClientForTest(c: BedrockLike | null): void {
  _override = c;
}

const SYSTEM_PROMPT = `You are a medical translator working in a small primary-care clinic during live phone calls between Spanish-speaking patients and English-speaking staff. You translate between Spanish (es) and English (en).

Rules — FOLLOW EXACTLY:
1. Output ONLY the translated text in the target language. No preamble, no explanation, no language label, no quotation marks.
2. Preserve every drug name, dose number, frequency, and unit verbatim (e.g. "metformin 500 mg twice daily" stays exact).
3. Preserve dates, times, phone numbers, and clinic-specific brand names verbatim.
4. NEVER refuse a benign clinical translation. The text comes from a real patient on a phone line; refusing breaks care.
5. If glossary hints are provided, prefer those exact target-language renderings.
6. Maintain register: patient utterances stay informal; staff utterances stay professional but warm.
7. If the input is already in the target language, return it unchanged.
8. Do not add safety disclaimers, "as an AI" caveats, or commentary.

Respond with a single JSON object: {"translation": "<target language text>"}`;

const REFUSAL_PATTERNS: RegExp[] = [
  /i(?:'m| am)? (?:sorry|unable|not able)/i,
  /i can(?:'?| no)t (?:help|assist|provide|translate)/i,
  /as an ai/i,
  /i (?:must|need to) decline/i,
];

function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}

interface BedrockClaudeBody {
  anthropic_version: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: Array<{
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: string }>;
  }>;
}

interface BedrockClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  type?: string;
}

function buildUserPrompt(args: TranslateArgs, hits: GlossaryHit[]): string {
  const direction =
    args.src === args.dst
      ? `Same-language passthrough (${args.src})`
      : `${args.src.toUpperCase()} → ${args.dst.toUpperCase()}`;
  const hintLines = hits.length
    ? hits
        .map((h) => {
          const target = args.dst === "es" ? h.term.es : h.term.en;
          const source = args.dst === "es" ? h.term.en : h.term.es;
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

function decodeBody(body: unknown): string {
  if (!body) throw new TranslateError("empty bedrock response", { retryable: true });
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToString" in body &&
    typeof (body as { transformToString: unknown }).transformToString === "function"
  ) {
    // Streaming body — handled by caller, we return a placeholder marker the
    // caller resolves before this path fires. Should not reach here in practice.
    throw new TranslateError("unresolved streaming body", { retryable: true });
  }
  if (typeof body === "string") return body;
  throw new TranslateError("unexpected bedrock body shape", { retryable: true });
}

function parseModelText(raw: string): string {
  // Try JSON first; fall back to raw if the model dropped the envelope.
  // This is the "parse JSON defensively" requirement.
  const trimmed = raw.trim();
  // Sometimes the model wraps in code fences.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    const obj = JSON.parse(candidate) as { translation?: unknown };
    if (typeof obj.translation === "string" && obj.translation.length > 0) {
      return obj.translation;
    }
  } catch {
    // not JSON
  }
  // Last resort: assume the model emitted bare target text.
  if (candidate.length > 0) return candidate;
  throw new TranslateError("empty translation", { retryable: true });
}

function mapHttpToTranslateError(status: number, msg: string, cause?: unknown): TranslateError {
  if (status === 429) {
    return new TranslateError(`rate limited (${status})`, {
      retryable: true,
      status: 429,
      cause,
    });
  }
  if (status >= 500) {
    return new TranslateError(`upstream ${status}: ${msg}`, {
      retryable: true,
      status: 502,
      cause,
    });
  }
  return new TranslateError(`upstream ${status}: ${msg}`, {
    retryable: false,
    status: status >= 400 ? 502 : 500,
    cause,
  });
}

function isAwsHttpError(
  err: unknown,
): err is { name: string; $metadata?: { httpStatusCode?: number }; message?: string } {
  return typeof err === "object" && err !== null && "$metadata" in err;
}

export async function translate(args: TranslateArgs): Promise<TranslateResult> {
  const dialect: Dialect = args.dialect ?? "all";
  const hits = args.glossaryHits ?? findGlossaryHits(args.text, dialect);

  const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;

  const requestBody: BedrockClaudeBody = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: buildUserPrompt(args, hits) }],
      },
    ],
  };

  const cmd = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(requestBody)),
  });

  const c: BedrockLike = _override ?? (client() as unknown as BedrockLike);

  let response: Awaited<ReturnType<BedrockLike["send"]>>;
  try {
    response = await c.send(cmd);
  } catch (err: unknown) {
    if (isAwsHttpError(err)) {
      const status = err.$metadata?.httpStatusCode ?? 500;
      throw mapHttpToTranslateError(status, err.message ?? err.name, err);
    }
    throw new TranslateError("bedrock invoke failed", { retryable: true, cause: err });
  }

  // Resolve body — both Uint8Array (msw test path) and stream path supported.
  let raw: string;
  const body = response.body;
  if (
    body &&
    typeof body === "object" &&
    "transformToString" in body &&
    typeof (body as { transformToString: () => Promise<string> }).transformToString === "function"
  ) {
    raw = await (body as { transformToString: () => Promise<string> }).transformToString();
  } else {
    raw = decodeBody(body);
  }

  let parsed: BedrockClaudeResponse;
  try {
    parsed = JSON.parse(raw) as BedrockClaudeResponse;
  } catch (err) {
    throw new TranslateError("invalid bedrock JSON envelope", {
      retryable: true,
      cause: err,
    });
  }

  const text = (parsed.content ?? [])
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");

  if (!text) {
    throw new TranslateError("no text content from model", { retryable: true });
  }

  const translation = parseModelText(text);

  if (looksLikeRefusal(translation)) {
    throw new TranslateError("model refused benign clinical translation", {
      retryable: false,
      refusal: true,
    });
  }

  return {
    translation,
    glossary_hits: hits.map((h) => ({
      en: h.term.en,
      es: h.term.es,
      category: h.term.category,
    })),
  };
}

// ---------------------------------------------------------------------------
// Track C1 — streaming reply suggestion.
// ---------------------------------------------------------------------------

export interface SuggestionResult {
  suggestion: string;
  confidence: number;
  reasoning: string;
  escalate: boolean;
}

export interface SuggestTurn {
  /** Who said this turn — patient (translated to EN) or staff (EN). */
  role: "patient" | "staff";
  /** English text of the turn. Patient turns are the EN translation. */
  text: string;
}

export interface SuggestArgs {
  transcript: SuggestTurn[];
  clinicContext: ClinicConfig;
  dialect: Dialect;
}

export type SuggestStreamEvent =
  | { token: string; final?: never }
  | { token?: never; final: SuggestionResult };

// Streaming-side test seam. Yields raw bedrock event payloads so tests can
// drive the parser without touching the AWS SDK.
export interface BedrockStreamLike {
  send: (cmd: InvokeModelWithResponseStreamCommand) => Promise<{
    body?: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }>;
  }>;
}
let _streamOverride: BedrockStreamLike | null = null;
export function __setBedrockStreamClientForTest(c: BedrockStreamLike | null): void {
  _streamOverride = c;
}

interface BedrockStreamChunk {
  type?: string;
  delta?: { type?: string; text?: string; partial_json?: string };
  index?: number;
  content_block?: { type?: string; text?: string };
}

function isStreamHttpError(
  err: unknown,
): err is { name: string; $metadata?: { httpStatusCode?: number }; message?: string } {
  return typeof err === "object" && err !== null && "$metadata" in err;
}

/** Best-effort JSON-tail recovery — find the first `{` and last `}`. */
function extractJsonObject(raw: string): string | null {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return raw.slice(first, last + 1);
}

function clampConfidence(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  // Two-decimal precision aligns with the numeric(3,2) DB column.
  return Math.round(n * 100) / 100;
}

function parseSuggestion(raw: string): SuggestionResult {
  const candidate = extractJsonObject(raw.trim()) ?? raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new SuggestError("model returned non-JSON suggestion", {
      retryable: true,
      cause: err,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new SuggestError("model suggestion was not an object", { retryable: true });
  }
  const obj = parsed as Record<string, unknown>;
  const suggestion = typeof obj.suggestion === "string" ? obj.suggestion : "";
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
  const escalate = obj.escalate === true;
  const confidence = clampConfidence(obj.confidence);
  if (!suggestion) {
    throw new SuggestError("empty suggestion in model output", { retryable: true });
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

interface BedrockClaudeStreamBody {
  anthropic_version: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: Array<{
    role: "user" | "assistant";
    content: Array<{ type: "text"; text: string }>;
  }>;
}

/**
 * Streams a reply suggestion from Bedrock. Yields incremental token events
 * as the model emits text deltas; yields a final parsed `SuggestionResult`
 * once the stream completes.
 *
 * Throws `SuggestError` on transport / parse / refusal failure.
 */
export async function* suggestReply(
  args: SuggestArgs,
): AsyncIterable<SuggestStreamEvent> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID;

  const system = buildSuggestSystemPrompt({
    clinic: args.clinicContext,
    dialect: args.dialect,
  });

  const requestBody: BedrockClaudeStreamBody = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 512,
    temperature: 0.3,
    system,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: buildSuggestUserPrompt(args.transcript) }],
      },
    ],
  };

  const cmd = new InvokeModelWithResponseStreamCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(JSON.stringify(requestBody)),
  });

  const c: BedrockStreamLike =
    _streamOverride ?? (client() as unknown as BedrockStreamLike);

  let response: Awaited<ReturnType<BedrockStreamLike["send"]>>;
  try {
    response = await c.send(cmd);
  } catch (err: unknown) {
    if (isStreamHttpError(err)) {
      const status = err.$metadata?.httpStatusCode ?? 500;
      throw new SuggestError(`bedrock stream error: ${err.name}`, {
        retryable: status === 429 || status >= 500,
        status: status === 429 ? 429 : 502,
        cause: err,
      });
    }
    throw new SuggestError("bedrock stream invoke failed", {
      retryable: true,
      cause: err,
    });
  }

  const body = response.body;
  if (!body) {
    throw new SuggestError("empty bedrock stream body", { retryable: true });
  }

  const decoder = new TextDecoder();
  let assembled = "";
  try {
    for await (const event of body) {
      const bytes = event.chunk?.bytes;
      if (!bytes) continue;
      const raw = decoder.decode(bytes, { stream: true });
      // Each event is a JSON object describing a delta block.
      let chunk: BedrockStreamChunk;
      try {
        chunk = JSON.parse(raw) as BedrockStreamChunk;
      } catch {
        // Some transports concatenate multiple events; try line-split.
        const lines = raw.split("\n").filter((l) => l.trim().length > 0);
        for (const line of lines) {
          try {
            const sub = JSON.parse(line) as BedrockStreamChunk;
            const tok = extractTokenFromChunk(sub);
            if (tok) {
              assembled += tok;
              yield { token: tok };
            }
          } catch {
            // Skip malformed sub-chunks; the assembled tail still parses below.
          }
        }
        continue;
      }
      const tok = extractTokenFromChunk(chunk);
      if (tok) {
        assembled += tok;
        yield { token: tok };
      }
    }
  } catch (err: unknown) {
    throw new SuggestError("bedrock stream interrupted", {
      retryable: true,
      cause: err,
    });
  }

  const final = parseSuggestion(assembled);
  yield { final };
}

function extractTokenFromChunk(chunk: BedrockStreamChunk): string {
  // Anthropic-on-Bedrock streaming envelope shapes:
  //   { type: 'content_block_delta', delta: { type: 'text_delta', text: '...' } }
  //   { type: 'content_block_start', content_block: { type: 'text', text: '...' } }
  if (chunk.delta?.text) return chunk.delta.text;
  if (chunk.delta?.partial_json) return chunk.delta.partial_json;
  if (chunk.content_block?.text) return chunk.content_block.text;
  return "";
}
