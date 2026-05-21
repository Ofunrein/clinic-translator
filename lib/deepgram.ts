// Track B2. Deepgram Nova-3 ES streaming WebSocket factory.
// Used by /api/stt to proxy patient audio frames to Deepgram and parse
// the JSON envelopes Deepgram emits back.
//
// Spec §4.2, §5.1 step 3, §7 (Deepgram WS drop → exp backoff).

const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen?language=es&model=nova-3&interim_results=true&endpointing=500&smart_format=true&encoding=linear16&sample_rate=16000";

export interface DeepgramAlternative {
  transcript: string;
  confidence: number;
}

export interface DeepgramFrame {
  type: "Results" | "Metadata" | "SpeechStarted" | "UtteranceEnd" | string;
  channel: { alternatives: DeepgramAlternative[] };
  is_final: boolean;
  speech_final: boolean;
}

/**
 * Open a Deepgram streaming WS. The Authorization header carries the API
 * key. Fast-fail at the call site if `DEEPGRAM_API_KEY` is missing.
 *
 * The platform's `WebSocket` ctor varies between Edge and Node runtimes.
 * Edge exposes `globalThis.WebSocket`; Node 22 also exposes it as a global
 * since v22.4 (undici-backed). Browser-style WebSocket clients cannot set
 * arbitrary headers, so Deepgram's documented subprotocol auth is used:
 * `Sec-WebSocket-Protocol: token, <KEY>`.
 *
 * Caller is responsible for `.close()` and reconnect/backoff.
 */
export function createDeepgramSocket(): WebSocket {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not set; cannot open Deepgram WS.");
  }
  const Ctor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (typeof Ctor !== "function") {
    // EDGE_WS_TODO: surface a clearer error if the runtime doesn't expose
    // a global WebSocket — the Edge runtime always does.
    throw new Error("WebSocket ctor unavailable in this runtime");
  }
  return new Ctor(DEEPGRAM_URL, ["token", apiKey]);
}

export function parseDeepgramFrame(raw: string): DeepgramFrame | null {
  try {
    const parsed = JSON.parse(raw) as DeepgramFrame;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.type === "string" &&
      parsed.channel &&
      Array.isArray(parsed.channel.alternatives)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function pickTranscript(frame: DeepgramFrame): {
  text: string;
  confidence: number;
} | null {
  const alt = frame.channel.alternatives[0];
  if (!alt) return null;
  const text = typeof alt.transcript === "string" ? alt.transcript : "";
  if (!text) return null;
  return { text, confidence: typeof alt.confidence === "number" ? alt.confidence : 1 };
}

export const DEEPGRAM_BACKOFF_MS = [250, 500, 1000, 2000, 4000];
