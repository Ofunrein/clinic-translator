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

import { createServiceClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import {
  DEEPGRAM_BACKOFF_MS,
  parseDeepgramFrame,
  pickTranscript,
} from "@/lib/deepgram";
import { translate as dispatchTranslate } from "@/lib/providers/clients";
import { LATENCY_PRESETS } from "@/lib/providers/presets";
import { findGlossaryHits } from "@/lib/medical-glossary";

export const runtime = "edge";

interface ClientFrame {
  type: "partial" | "final";
  text: string;
  translation?: string;
}

const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen?language=es&model=nova-3&interim_results=true&endpointing=500&smart_format=true&encoding=linear16&sample_rate=16000";

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

async function authorize(req: Request): Promise<{ ok: true } | { ok: false; code: number }> {
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
    const svc = createServiceClient();
    const { data, error } = await svc.auth.getUser(token);
    if (error || !data.user) return { ok: false, code: 4401 };
    const email = data.user.email ?? null;
    if (!isEmailAllowed(email)) return { ok: false, code: 4403 };
    return { ok: true };
  } catch {
    return { ok: false, code: 4401 };
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

function buildDeepgramSocket(): WebSocket {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY not set");
  }
  // EDGE_WS_TODO: Edge runtime's `WebSocket` constructor doesn't accept a
  // headers option. Deepgram supports subprotocol-based auth: client sends
  // `Sec-WebSocket-Protocol: token, <KEY>`. This is the documented path for
  // browser-style WebSocket clients.
  return new WebSocket(DEEPGRAM_URL, ["token", apiKey]);
}

interface BridgeState {
  client: WebSocket;
  upstream: WebSocket | null;
  backoffIdx: number;
  closing: boolean;
}

function startUpstream(state: BridgeState): void {
  if (state.closing) return;
  let upstream: WebSocket;
  try {
    upstream = buildDeepgramSocket();
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
          const hits = findGlossaryHits(t.text, "mx");
          // Edge runtime can't reach Postgres directly; fall back to the
          // balanced preset as the documented behavior when the clinic
          // settings row is unreachable. Translate provider stays Bedrock.
          const translateConfig = LATENCY_PRESETS.balanced.translate;
          const result = await dispatchTranslate({
            text: t.text,
            src: "es",
            dst: "en",
            dialect: "mx",
            glossaryHits: hits,
            config: translateConfig,
          });
          safeSend(state.client, {
            type: "final",
            text: t.text,
            translation: result.translation,
          });
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

  const pair = new Pair();
  const clientSide = pair[0];
  const serverSide = pair[1] as AcceptableSocket;

  // EDGE_WS_TODO: Vercel Edge requires `serverSide.accept()` before the
  // socket transitions to OPEN.
  if (typeof serverSide.accept === "function") {
    serverSide.accept();
  }

  const state: BridgeState = {
    client: serverSide,
    upstream: null,
    backoffIdx: 0,
    closing: false,
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
