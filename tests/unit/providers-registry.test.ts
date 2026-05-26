// Track C2. Provider registry + presets unit tests.

import { describe, it, expect } from "vitest";
import {
  PROVIDER_REGISTRY,
  getCatalogEntry,
  isValidModel,
  isValidVoice,
} from "@/lib/providers/registry";
import { LATENCY_PRESETS, applyPreset } from "@/lib/providers/presets";
import { DEEPGRAM_AURA_ES_VOICES } from "@/lib/providers/deepgram-voices";
import type { ProviderConfig } from "@/lib/providers/types";

describe("provider registry", () => {
  it("lists default cheapest+fastest providers", () => {
    expect(PROVIDER_REGISTRY.stt.deepgram).toBeDefined();
    expect(PROVIDER_REGISTRY.translate.bedrock).toBeDefined();
    expect(PROVIDER_REGISTRY.tts.polly).toBeDefined();
    expect(PROVIDER_REGISTRY.suggest.bedrock).toBeDefined();
  });

  it("validates models against the catalog", () => {
    expect(isValidModel("translate", "bedrock", "anthropic.claude-haiku-4-5-v1:0")).toBe(true);
    expect(isValidModel("translate", "bedrock", "not-a-real-model")).toBe(false);
    expect(isValidModel("stt", "deepgram", "nova-3")).toBe(true);
  });

  it("validates voices against the catalog", () => {
    expect(isValidVoice("polly", "Lupe", "generative")).toBe(true);
    expect(isValidVoice("polly", "Lupe", "neural")).toBe(true);
    // Wrong engine for voice → reject
    expect(isValidVoice("polly", "Lupe", "sonic-2")).toBe(false);
    // Cartesia wired up
    expect(isValidVoice("cartesia", "sonic-2-es-female", "sonic-2")).toBe(true);
  });

  it("exposes every Deepgram Aura-2 Spanish voice in the TTS catalog", () => {
    const expectedIds = [
      "aura-2-sirio-es",
      "aura-2-nestor-es",
      "aura-2-carina-es",
      "aura-2-celeste-es",
      "aura-2-alvaro-es",
      "aura-2-diana-es",
      "aura-2-aquila-es",
      "aura-2-selena-es",
      "aura-2-estrella-es",
      "aura-2-javier-es",
      "aura-2-agustina-es",
      "aura-2-antonia-es",
      "aura-2-gloria-es",
      "aura-2-luciano-es",
      "aura-2-olivia-es",
      "aura-2-silvia-es",
      "aura-2-valerio-es",
    ];
    expect(DEEPGRAM_AURA_ES_VOICES.map((v) => v.id).sort()).toEqual(
      expectedIds.sort(),
    );
    for (const id of expectedIds) {
      expect(isValidVoice("deepgram", id, "aura-2")).toBe(true);
    }
  });

  it("deepgram STT catalog includes flux-general-multi", () => {
    const entry = getCatalogEntry("stt", "deepgram");
    expect(entry).not.toBeNull();
    const fluxModel = entry!.models.find((m) => m.id === "flux-general-multi");
    expect(fluxModel).toBeDefined();
    expect(fluxModel!.label).toContain("Flux");
  });

  it("flags non-BAA providers in baaTier", () => {
    expect(PROVIDER_REGISTRY.tts.elevenlabs.baaTier).toBe("none");
    expect(PROVIDER_REGISTRY.tts.cartesia.baaTier).toBe("enterprise-only");
    expect(PROVIDER_REGISTRY.tts.polly.baaTier).toBe("covered");
  });
});

describe("LATENCY_PRESETS", () => {
  const presetIds = ["fast", "balanced", "accurate"] as const;

  for (const mode of presetIds) {
    it(`preset '${mode}' references catalog entries that all exist`, () => {
      const cfg = LATENCY_PRESETS[mode];
      expect(getCatalogEntry("stt", cfg.stt.provider)).not.toBeNull();
      expect(getCatalogEntry("translate", cfg.translate.provider)).not.toBeNull();
      expect(getCatalogEntry("tts", cfg.tts.provider)).not.toBeNull();
      expect(getCatalogEntry("suggest", cfg.suggest.provider)).not.toBeNull();
      expect(isValidModel("stt", cfg.stt.provider, cfg.stt.model)).toBe(true);
      expect(isValidModel("translate", cfg.translate.provider, cfg.translate.model)).toBe(true);
      expect(isValidVoice(cfg.tts.provider, cfg.tts.voice, cfg.tts.engine)).toBe(true);
      expect(isValidModel("suggest", cfg.suggest.provider, cfg.suggest.model)).toBe(true);
    });
  }

  it("balanced preset matches spec defaults (Deepgram STT + Groq + Deepgram Aura TTS)", () => {
    const cfg = LATENCY_PRESETS.balanced;
    expect(cfg.stt.provider).toBe("deepgram");
    expect(cfg.stt.model).toBe("nova-3");
    expect(cfg.translate.provider).toBe("groq");
    expect(cfg.translate.model).toBe("llama-3.3-70b-versatile");
    expect(cfg.suggest.provider).toBe("groq");
    expect(cfg.tts.provider).toBe("deepgram");
    expect(cfg.tts.voice).toBe("aura-2-olivia-es");
    expect(cfg.tts.engine).toBe("aura-2");
    expect(cfg.latencyMode).toBe("balanced");
    expect(cfg.realtimeMode).toBe("text-middleman");
  });

  it("applyPreset returns a deep clone (mutating result does not poison the preset)", () => {
    const a: ProviderConfig = applyPreset("balanced");
    a.translate.model = "tampered";
    const b: ProviderConfig = applyPreset("balanced");
    expect(b.translate.model).toBe("llama-3.3-70b-versatile");
  });
});
