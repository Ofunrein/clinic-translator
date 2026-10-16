import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { translateGroq, suggestReplyGroq } from "@/lib/providers/clients/groq";
import { synthesizeDeepgram } from "@/lib/providers/clients/deepgram-tts";
import { DEFAULT_CLINIC } from "@/lib/clinic-prompts";

// Explicit opt-in: these bounded checks call the real vendors using synthetic text.
describe.skipIf(!process.env.CLINIC_LIVE_ENV_FILE)("live provider smoke", () => {
  it("translates both directions, streams a suggestion and synthesizes Spanish audio", async () => {
    Object.assign(process.env, parseEnv(readFileSync(process.env.CLINIC_LIVE_ENV_FILE!, "utf8")));
    const en = await translateGroq({ text: "Tengo dolor de cabeza desde ayer.", src: "es", dst: "en" });
    expect(en.translation.toLowerCase()).toContain("headache");
    const es = await translateGroq({ text: "Please take 5 mg once daily.", src: "en", dst: "es" });
    expect(es.translation).toMatch(/5\s*mg/);
    expect(es.translation.toLowerCase()).toMatch(/d[ií]a|diari/);
    let suggestion = "";
    for await (const ev of suggestReplyGroq({ transcript: [{ role: "patient", text: en.translation }], clinicContext: DEFAULT_CLINIC, dialect: "mx" })) {
      if ("final" in ev && ev.final) suggestion = ev.final.suggestion;
    }
    expect(suggestion.length).toBeGreaterThan(5);
    const speech = await synthesizeDeepgram({ text: es.translation, voice: "aura-2-olivia-es", engine: "aura-2" });
    expect(speech.audio.byteLength).toBeGreaterThan(1000);
    console.info("Synthetic provider smoke passed: ES→EN, EN→ES, streamed suggestion, Spanish MP3.");
  }, 60000);
});
