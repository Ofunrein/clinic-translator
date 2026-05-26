// Track B2. /api/stt — Edge runtime WebSocket proxy to Deepgram Nova-3 ES.
// Spec §4.2, §5.1 step 3, §7 (Deepgram WS drop → exp backoff).
//
// Wire shape (browser ↔ this route): JSON frames `{type, text, translation?}`
// where type ∈ {'partial','final'}. Browser sends raw 16-bit PCM mono @
// 16 kHz as ArrayBuffer messages (matches the AudioWorklet in lib/hooks/useStt).
//
// Auth: Authorization: Bearer <Supabase JWT>. WS upgrade requests carry
// the header; we verify with the service-role client and the email allowlist.
//
// Reconnect: when the upstream Deepgram WS drops, we reconnect on backoff
// 250→500→1000→2000→4000 ms (5 attempts). After the last attempt, we close
// the client WS with code 1011.

import { isEmailAllowed } from "@/lib/auth/allowlist";
import {
  DEEPGRAM_BACKOFF_MS,
  createDeepgramSocket,
  parseDeepgramFrame,
  pickTranscript,
} from "@/lib/deepgram";
import { findGlossaryHits } from "@/lib/medical-glossary";
import { transcribeOpenai, translateOpenai } from "@/lib/providers/clients/openai";
import { getActiveProviderConfig } from "@/lib/settings";
import { jwtVerify } from "jose";

export const runtime = "edge";

interface ClientFrame {
  type: "partial" | "final";
  text: string;
  translation?: string;
}

// EDGE_WS_TODO: Vercel Edge runtime exposes `WebSocketPair` and the
// `webSocket` Response init key (Cloudflare-style). The runtime currently
// supports server-side WebSocket via the Edge "WebSocket" upgrade pattern;
// this code uses globalThis.WebSocketPair if present and falls through to a
// 501 otherwise so it fails loudly outside that platform.

interface WebSocketPairCtor {
  new (): { 0: WebSocket; 1: WebSocket };
}

function getWebSocketPair(): WebSocketPairCtor | null {
  const g = globalThis as { WebSocketPair?: WebSocketPairCtor };
  return g.WebSocketPair ?? null;
}

interface AcceptableSocket extends WebSocket {
  // EDGE_WS_TODO: Vercel/Cloudflare Edge exposes `accept()` to mark the
  // server-side socket as live. Standard browser WebSocket doesn't.
  accept?(): void;
}

async function authorize(
  req: Request,
): Promise<{ ok: true; token: string } | { ok: false; code: number }> {
  // Browsers cannot set Authorization headers on WebSocket clients, so the
  // useStt hook passes the Supabase JWT as a `?token=...` query param. Accept
  // either path (Authorization header for server-to-server, query for browser).
  const auth =
    req.headers.get("authorization") ?? req.headers.get("Authorization");
  const headerToken = auth && auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : null;
  const queryToken = new URL(req.url).searchParams.get("token");
  const token = headerToken ?? queryToken;

  if (!token) {
    return { ok: false, code: 4401 };
  }

  try {
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) return { ok: false, code: 4500 };
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!isEmailAllowed(email)) return { ok: false, code: 4403 };
    return { ok: true, token };
  } catch {
    return { ok: false, code: 4401 };
  }
}

/** Edge-safe translate: delegate to the Node /api/translate route (Bedrock, etc.). */
async function translateViaApi(args: {
  origin: string;
  token: string;
  text: string;
  src: "es" | "en";
  dst: "es" | "en";
}): Promise<string | null> {
  try {
    const res = await fetch(`${args.origin}/api/translate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: args.text, src: args.src, dst: args.dst }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { translation?: string };
    return typeof data.translation === "string" ? data.translation : null;
  } catch {
    return null;
  }
}

function safeSend(ws: WebSocket, frame: ClientFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // Client likely closed; ignore.
  }
}

function safeBinarySend(ws: WebSocket, data: ArrayBuffer): void {
  try {
    ws.send(data);
  } catch {
    // ignore
  }
}

// DEV_STT_OPENAI_CHUNKED ------------------------------------------------
// OpenAI Whisper has no native streaming endpoint. When the active STT
// provider is `openai`, we buffer ~2s windows of 16 kHz mono PCM from the
// browser, wrap each in a minimal WAV container, and POST to
// /v1/audio/transcriptions. Each window produces a single `final` frame;
// no `partial` frames are emitted. This is best-effort dev behavior — for
// production-quality interim transcripts use Deepgram.

const PCM_SAMPLE_RATE_HZ = 16000;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_CHANNELS = 1;
const BATCH_WINDOW_MS = 2000;
const BATCH_WINDOW_BYTES =
  (PCM_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE * PCM_CHANNELS * BATCH_WINDOW_MS) /
  1000;
// Don't ship windows smaller than ~150 ms — Whisper rejects very short
// clips with a 400.
const BATCH_MIN_BYTES = (PCM_SAMPLE_RATE_HZ * PCM_BYTES_PER_SAMPLE * 150) / 1000;

function pickSttProvider(): "deepgram" | "openai" {
  // Explicit override takes precedence so devs can force a mode.
  const force = (process.env.STT_PROVIDER ?? "").toLowerCase();
  if (force === "openai") return "openai";
  if (force === "deepgram") return "deepgram";
  // Auto: if DEEPGRAM_API_KEY missing but OPENAI_API_KEY present, use openai.
  if (!process.env.DEEPGRAM_API_KEY && process.env.OPENAI_API_KEY) {
    return "openai";
  }
  return "deepgram";
}

/** Wrap raw 16-bit mono PCM @ 16 kHz in a minimal WAV header. */
function wrapPcmInWav(pcm: Uint8Array): Uint8Array {
  const dataLen = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true); // PCM fmt chunk size
  v.setUint16(20, 1, true); // PCM format
  v.setUint16(22, PCM_CHANNELS, true);
  v.setUint32(24, PCM_SAMPLE_RATE_HZ, true);
  v.setUint32(
    28,
    PCM_SAMPLE_RATE_HZ * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE,
    true,
  );
  v.setUint16(32, PCM_CHANNELS * PCM_BYTES_PER_SAMPLE, true);
  v.setUint16(34, 8 * PCM_BYTES_PER_SAMPLE, true);
  writeStr(36, "data");
  v.setUint32(40, dataLen, true);
  const out = new Uint8Array(44 + dataLen);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

interface OpenaiBatchState {
  client: WebSocket;
  buffer: Uint8Array[];
  bufferedBytes: number;
  closing: boolean;
  flushing: boolean;
}

async function flushOpenaiBatch(state: OpenaiBatchState): Promise<void> {
  if (state.flushing || state.closing) return;
  if (state.bufferedBytes < BATCH_MIN_BYTES) return;
  state.flushing = true;
  const merged = new Uint8Array(state.bufferedBytes);
  let off = 0;
  for (const chunk of state.buffer) {
    merged.set(chunk, off);
    off += chunk.byteLength;
  }
  state.buffer = [];
  state.bufferedBytes = 0;

  try {
    const wav = wrapPcmInWav(merged);
    // Edge runtime exposes Buffer via the node:buffer polyfill on Vercel;
    // we coerce defensively for environments where it's missing.
    const buf =
      typeof Buffer !== "undefined"
        ? Buffer.from(wav)
        : (wav as unknown as Buffer);
    const result = await transcribeOpenai({ audioBuffer: buf, lang: "es" });
    const text = result.transcript.trim();
    if (text.length > 0) {
      safeSend(state.client, { type: "final", text });
      // Kick translate in the background — same shape as the deepgram path.
      void (async () => {
        try {
          const hits = findGlossaryHits(text, "mx");
          const out = await translateOpenai({
            text,
            src: "es",
            dst: "en",
            glossaryHits: hits.map((h) => ({
              en: h.term.en,
              es: h.term.es,
            })),
          });
          safeSend(state.client, {
            type: "final",
            text,
            translation: out.translation,
          });
        } catch {
          // Frontend will retry via /api/translate.
        }
      })();
    }
  } catch {
    // Per-window failure is non-fatal in dev mode — the next window will retry.
  } finally {
    state.flushing = false;
  }
}

function startOpenaiBatch(client: WebSocket): {
  onMessage: (data: ArrayBuffer) => void;
  close: () => void;
} {
  const state: OpenaiBatchState = {
    client,
    buffer: [],
    bufferedBytes: 0,
    closing: false,
    flushing: false,
  };
  return {
    onMessage: (data) => {
      if (state.closing) return;
      const chunk = new Uint8Array(data);
      state.buffer.push(chunk);
      state.bufferedBytes += chunk.byteLength;
      if (state.bufferedBytes >= BATCH_WINDOW_BYTES) {
        void flushOpenaiBatch(state);
      }
    },
    close: () => {
      state.closing = true;
      // Best-effort: flush any remaining audio so the last utterance lands.
      if (state.bufferedBytes >= BATCH_MIN_BYTES) {
        void flushOpenaiBatch(state);
      }
    },
  };
}

interface BridgeState {
  client: WebSocket;
  upstream: WebSocket | null;
  backoffIdx: number;
  closing: boolean;
  origin: string;
  token: string;
  sttModel: string;
}

function startUpstream(state: BridgeState): void {
  if (state.closing) return;
  let upstream: WebSocket;
  try {
    upstream = createDeepgramSocket(state.sttModel);
  } catch {
    // No API key or constructor failure — close the client cleanly.
    try { state.client.close(1011, "stt unavailable"); } catch { /* noop */ }
    state.closing = true;
    return;
  }
  state.upstream = upstream;
  upstream.binaryType = "arraybuffer";

  upstream.addEventListener("open", () => {
    state.backoffIdx = 0;
  });

  upstream.addEventListener("message", (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return;
    const frame = parseDeepgramFrame(ev.data);
    if (!frame || frame.type !== "Results") return;
    const t = pickTranscript(frame);
    if (!t || !t.text.trim()) return;

    if (frame.is_final) {
      // Translate finals only — partials skip translate to save tokens.
      // We send the final text immediately, then patch the translation
      // when the model returns. The frontend's `promotePartial` only
      // reads `text` + optional `translation` so this matches.
      safeSend(state.client, { type: "final", text: t.text });

      void (async () => {
        try {
          const translation = await translateViaApi({
            origin: state.origin,
            token: state.token,
            text: t.text,
            src: "es",
            dst: "en",
          });
          if (translation) {
            safeSend(state.client, {
              type: "final",
              text: t.text,
              translation,
            });
          }
        } catch {
          // Swallow — frontend can re-trigger via /api/translate retry button.
        }
      })();
    } else {
      safeSend(state.client, { type: "partial", text: t.text });
    }
  });

  upstream.addEventListener("close", () => {
    if (state.closing) return;
    state.upstream = null;
    if (state.backoffIdx >= DEEPGRAM_BACKOFF_MS.length) {
      try { state.client.close(1011, "stt reconnect exhausted"); } catch { /* noop */ }
      state.closing = true;
      return;
    }
    const delay =
      DEEPGRAM_BACKOFF_MS[Math.min(state.backoffIdx, DEEPGRAM_BACKOFF_MS.length - 1)];
    state.backoffIdx += 1;
    setTimeout(() => startUpstream(state), delay);
  });

  upstream.addEventListener("error", () => {
    // The close handler runs after error; let it drive reconnect.
  });
}

export async function GET(req: Request): Promise<Response> {
  // Reject non-upgrade requests so the route is observable via HTTP probes.
  const upgrade = req.headers.get("upgrade")?.toLowerCase();
  if (upgrade !== "websocket") {
    return new Response("expected websocket upgrade", { status: 426 });
  }

  const Pair = getWebSocketPair();
  if (!Pair) {
    // EDGE_WS_TODO: returns 501 if running on a runtime without WebSocketPair
    // (e.g. local Node without Edge polyfill). Vercel Edge always has it.
    return new Response("websocket not supported in this runtime", { status: 501 });
  }

  const authz = await authorize(req);
  if (!authz.ok) {
    return new Response("unauthorized", { status: authz.code === 4403 ? 403 : 401 });
  }
  const origin = new URL(req.url).origin;
  const { token } = authz;

  let sttModel = "nova-3";
  try {
    const providerConfig = await getActiveProviderConfig();
    if (providerConfig.stt.provider === "deepgram") {
      sttModel = providerConfig.stt.model;
    }
  } catch {
    // nova-3 fallback keeps the session alive even if settings DB is unreachable
  }

  const pair = new Pair();
  const clientSide = pair[0];
  const serverSide = pair[1] as AcceptableSocket;

  // EDGE_WS_TODO: Vercel Edge requires `serverSide.accept()` before the
  // socket transitions to OPEN.
  if (typeof serverSide.accept === "function") {
    serverSide.accept();
  }

  const provider = pickSttProvider();

  if (provider === "openai") {
    // DEV_STT_OPENAI_CHUNKED: bypass the Deepgram bridge entirely.
    const batch = startOpenaiBatch(serverSide);
    serverSide.addEventListener("message", (ev: MessageEvent) => {
      const data = ev.data;
      if (data instanceof ArrayBuffer) {
        batch.onMessage(data);
      }
    });
    serverSide.addEventListener("close", () => {
      batch.close();
    });
    serverSide.addEventListener("error", () => {
      batch.close();
    });
    const initWithSocket = {
      status: 101,
      webSocket: clientSide,
    } as unknown as ResponseInit;
    return new Response(null, initWithSocket);
  }

  const state: BridgeState = {
    client: serverSide,
    upstream: null,
    backoffIdx: 0,
    closing: false,
    origin,
    token,
    sttModel,
  };

  serverSide.addEventListener("message", (ev: MessageEvent) => {
    if (state.closing) return;
    const data = ev.data;
    if (data instanceof ArrayBuffer) {
      const u = state.upstream;
      if (u && u.readyState === 1 /* OPEN */) {
        safeBinarySend(u, data);
      }
      // If upstream is mid-reconnect, frames are dropped to keep latency low.
      return;
    }
    // Ignore stray text frames from the client; protocol is binary-only.
  });

  serverSide.addEventListener("close", () => {
    state.closing = true;
    if (state.upstream) {
      try { state.upstream.close(); } catch { /* noop */ }
    }
  });

  serverSide.addEventListener("error", () => {
    state.closing = true;
    if (state.upstream) {
      try { state.upstream.close(); } catch { /* noop */ }
    }
  });

  // Kick off upstream Deepgram session.
  startUpstream(state);

  // EDGE_WS_TODO: response init key is `webSocket` (camel-case) on Vercel
  // Edge / Cloudflare workers. Cast widens the standard ResponseInit.
  const initWithSocket = { status: 101, webSocket: clientSide } as unknown as ResponseInit;
  return new Response(null, initWithSocket);
}
