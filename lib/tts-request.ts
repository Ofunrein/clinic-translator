import type { TtsProvider } from "@/lib/providers/types";
import type { TtsRequest } from "@/lib/hooks/useTts";

export function buildTtsRequest(args: {
  text: string;
  sessionId?: string | null;
  tts?: TtsProvider | null;
  speed?: number | null;
}): TtsRequest {
  const req: TtsRequest = { text: args.text };
  if (args.tts?.provider === "deepgram" && args.tts.voice.trim()) {
    req.voice = args.tts.voice;
  }
  if (typeof args.speed === "number") {
    req.speed = args.speed;
  }
  if (args.sessionId) {
    req.sessionId = args.sessionId;
  }
  return req;
}
