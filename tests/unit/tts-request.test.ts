import { describe, expect, it } from "vitest";
import { buildTtsRequest } from "@/lib/tts-request";
import type { TtsProvider } from "@/lib/providers/types";

const selena: TtsProvider = {
  provider: "deepgram",
  voice: "aura-2-selena-es",
  engine: "aura-2",
};

describe("buildTtsRequest", () => {
  it("sends the selected Deepgram voice with every TTS request", () => {
    expect(
      buildTtsRequest({
        text: "Estamos bien",
        sessionId: "00000000-0000-0000-0000-000000000123",
        tts: selena,
      }),
    ).toEqual({
      text: "Estamos bien",
      voice: "aura-2-selena-es",
      sessionId: "00000000-0000-0000-0000-000000000123",
    });
  });

  it("omits voice only when settings have not loaded yet", () => {
    expect(buildTtsRequest({ text: "Hola", sessionId: null, tts: undefined })).toEqual({
      text: "Hola",
    });
  });

  it("sends the full aura-2-*-es id, not a short name", () => {
    const tts: TtsProvider = {
      provider: "deepgram",
      voice: "aura-2-selena-es",
      engine: "aura-2",
    };
    const req = buildTtsRequest({ text: "Hola", tts });
    expect(req.voice).toBe("aura-2-selena-es");
    expect(req.voice).toMatch(/^aura-2-.+-es$/);
  });

  it("does not send voice when provider is not deepgram", () => {
    const tts: TtsProvider = {
      provider: "openai-tts",
      voice: "nova",
      engine: "tts-1",
    };
    const req = buildTtsRequest({ text: "Hola", tts });
    expect(req.voice).toBeUndefined();
  });
});
