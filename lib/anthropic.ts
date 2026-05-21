// Track B2. AWS Bedrock Claude Sonnet 4.6 client wrapper for /api/translate.
// Spec §4.2, §5.1 step 5, §7 (translate refusal handling).
//
// Auth: standard AWS SDK provider chain (env, IAM role, AWS_PROFILE).
// Region: process.env.BEDROCK_REGION (default us-east-1).
// Model:  process.env.BEDROCK_MODEL_ID (default anthropic.claude-sonnet-4-6-v1:0).

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { TranslateError } from "./api/errors";
import { findGlossaryHits, type Dialect, type GlossaryHit } from "./medical-glossary";

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
