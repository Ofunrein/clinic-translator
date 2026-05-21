// Track C2. Provider registry + presets unit tests.

import { describe, it, expect } from "vitest";
import {
  PROVIDER_REGISTRY,
  getCatalogEntry,
  isValidModel,
  isValidVoice,
} from "@/lib/providers/registry";
import { LATENCY_PRESETS, applyPreset } from "@/lib/providers/presets";
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

  it("balanced preset matches spec defaults (Deepgram + Haiku 4.5 + Polly Generative Lupe)", () => {
    const cfg = LATENCY_PRESETS.balanced;
    expect(cfg.stt.provider).toBe("deepgram");
    expect(cfg.stt.model).toBe("nova-3");
    expect(cfg.translate.provider).toBe("bedrock");
    expect(cfg.translate.model).toBe("anthropic.claude-haiku-4-5-v1:0");
    expect(cfg.tts.provider).toBe("polly");
    expect(cfg.tts.voice).toBe("Lupe");
    expect(cfg.tts.engine).toBe("generative");
    expect(cfg.latencyMode).toBe("balanced");
    expect(cfg.realtimeMode).toBe("text-middleman");
  });

  it("applyPreset returns a deep clone (mutating result does not poison the preset)", () => {
    const a: ProviderConfig = applyPreset("balanced");
    a.translate.model = "tampered";
    const b: ProviderConfig = applyPreset("balanced");
    expect(b.translate.model).toBe("anthropic.claude-haiku-4-5-v1:0");
  });
});
