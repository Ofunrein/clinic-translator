// Track C2. Provider-agnostic dispatcher. Routes call into here instead of
// hardcoded vendor clients; this file switches on `config.provider` and
// delegates. Stubbed providers (Cartesia, Polly, Vertex, Azure, DeepL,
// ElevenLabs, OpenAI TTS, AWS Transcribe, Google Speech, Whisper-Azure)
// throw `ProviderNotImplementedError` (wrapped in the typed error envelope)
// until Phase 2 ships their real clients.
//
// PHI safety: this dispatcher accepts text as plain string (already
// decrypted by the caller) and forwards it to the underlying client; it
// never logs the text. Tests in `tests/unit/no-phi-log` enforce the rule.

import {
  translate as translateBedrock,
  suggestReply as suggestReplyBedrock,
  type TranslateArgs,
  type SuggestArgs,
  type SuggestStreamEvent as BedrockSuggestStreamEvent,
} from "@/lib/anthropic";
import { synthesize as synthesizeGoogle } from "@/lib/google-tts";
import { findGlossaryHits, type Dialect } from "@/lib/medical-glossary";
import type {
  SttProvider,
  TranslateProvider,
  TtsProvider,
  SuggestProvider,
  ProviderConfig,
} from "./types";
import { synthesizePolly } from "./clients/polly";
import { synthesizeCartesia } from "./clients/cartesia";
import { synthesizeOpenAi } from "./clients/openai-tts";
import { synthesizeElevenLabs } from "./clients/elevenlabs";
import { translateVertex, suggestVertex } from "./clients/vertex-gemini";
import { translateAzure, suggestAzure } from "./clients/azure-openai";
import { translateDeepL } from "./clients/deepl";
import {
  streamAwsTranscribe,
  streamGoogleSpeech,
  streamWhisperAzure,
} from "./clients/stt-stubs";
import {
  transcribeOpenai,
  translateOpenai,
  synthesizeOpenai,
  suggestReplyOpenai,
} from "./clients/openai";

export type TranslateResult = Awaited<ReturnType<typeof translateBedrock>>;
export type SuggestStreamEvent = BedrockSuggestStreamEvent;
export type SynthesizeResult = Awaited<ReturnType<typeof synthesizeGoogle>>;

// ----- STT -----
// STT is a streaming protocol that's wired at the route layer (the Edge
// websocket bridge in `app/api/stt/route.ts`). We expose a `streamStt`
// helper that the route can call to delegate based on config; for the
// default Deepgram path the route already owns the WS lifecycle, so this
// helper short-circuits and returns `null` to indicate "use the existing
// in-route bridge". Stub providers throw immediately.

export interface StreamSttHandle {
  /** Caller closes when client socket closes. */
  close: () => void;
}

export async function streamStt(
  config: SttProvider,
): Promise<StreamSttHandle | null> {
  switch (config.provider) {
    case "deepgram":
      // Default path: route handler owns the bridge today; signal "passthrough".
      return null;
    case "openai":
      // DEV_STT_OPENAI_CHUNKED: openai has no streaming STT endpoint. The
      // route owns the chunked-batch loop (buffer ~2s of audio → POST to
      // /v1/audio/transcriptions). Dispatcher signals "passthrough" the
      // same way the deepgram branch does.
      return null;
    case "aws-transcribe":
      await streamAwsTranscribe(config);
      return null;
    case "google-speech":
      await streamGoogleSpeech(config);
      return null;
    case "whisper-azure":
      await streamWhisperAzure(config);
      return null;
    default: {
      const _exhaustive: never = config;
      void _exhaustive;
      throw new Error("unknown stt provider");
    }
  }
}

// One-shot transcription for the chunked-batch dev path. The Edge STT route
// buffers ~2s windows then calls this per window when `config.provider === 'openai'`.
export async function transcribeOnce(args: {
  audioBuffer: Buffer;
  lang: "es" | "en";
  config: SttProvider;
}): Promise<{ transcript: string; isFinal: true; confidence?: number }> {
  switch (args.config.provider) {
    case "openai":
      return transcribeOpenai({ audioBuffer: args.audioBuffer, lang: args.lang });
    case "deepgram":
    case "aws-transcribe":
    case "google-speech":
    case "whisper-azure":
      throw new Error(
        `transcribeOnce only supports openai (got ${args.config.provider}); use streamStt for streaming providers`,
      );
    default: {
      const _exhaustive: never = args.config;
      void _exhaustive;
      throw new Error("unknown stt provider");
    }
  }
}

// ----- Translate -----
export interface DispatchTranslateArgs extends TranslateArgs {
  config: TranslateProvider;
}

export async function translate(args: DispatchTranslateArgs): Promise<TranslateResult> {
  const { config, ...rest } = args;
  switch (config.provider) {
    case "bedrock":
      return translateBedrock({ ...rest, modelId: config.model });
    case "vertex-gemini":
      return translateVertex({ ...rest, model: config.model });
    case "azure-openai":
      return translateAzure({ ...rest, model: config.model });
    case "deepl":
      return translateDeepL({ ...rest, model: config.model });
    case "openai": {
      const dialect: Dialect = rest.dialect ?? "all";
      const hits = rest.glossaryHits ?? findGlossaryHits(rest.text, dialect);
      const out = await translateOpenai({
        text: rest.text,
        src: rest.src,
        dst: rest.dst,
        glossaryHits: hits.map((h) => ({
          en: h.term.en,
          es: h.term.es,
        })),
      });
      return {
        translation: out.translation,
        glossary_hits: hits.map((h) => ({
          en: h.term.en,
          es: h.term.es,
          category: h.term.category,
        })),
      };
    }
    default: {
      const _exhaustive: never = config;
      void _exhaustive;
      throw new Error("unknown translate provider");
    }
  }
}

// ----- TTS -----
export interface DispatchSynthesizeArgs {
  text: string;
  config: TtsProvider;
}

export async function synthesize(
  args: DispatchSynthesizeArgs,
): Promise<SynthesizeResult> {
  const { text, config } = args;
  switch (config.provider) {
    case "google-tts":
      return synthesizeGoogle({ text, voice: config.voice });
    case "polly":
      return synthesizePolly({ text, voice: config.voice, engine: config.engine });
    case "cartesia":
      return synthesizeCartesia({ text, voice: config.voice, engine: config.engine });
    case "openai-tts":
      return synthesizeOpenAi({ text, voice: config.voice, engine: config.engine });
    case "elevenlabs":
      return synthesizeElevenLabs({ text, voice: config.voice, engine: config.engine });
    case "openai": {
      const audio = await synthesizeOpenai({
        text,
        voice: config.voice,
        model: config.engine,
      });
      return { audio, cacheHit: false, voice: config.voice, fellBack: false };
    }
    default: {
      const _exhaustive: never = config;
      void _exhaustive;
      throw new Error("unknown tts provider");
    }
  }
}

// ----- Suggest -----
export interface DispatchSuggestArgs extends SuggestArgs {
  config: SuggestProvider;
}

export async function* suggestReply(
  args: DispatchSuggestArgs,
): AsyncIterable<SuggestStreamEvent> {
  const { config, ...rest } = args;
  switch (config.provider) {
    case "bedrock": {
      for await (const ev of suggestReplyBedrock({ ...rest, modelId: config.model })) {
        yield ev;
      }
      return;
    }
    case "vertex-gemini":
      for await (const ev of suggestVertex({ ...rest, model: config.model })) {
        yield ev;
      }
      return;
    case "azure-openai":
      for await (const ev of suggestAzure({ ...rest, model: config.model })) {
        yield ev;
      }
      return;
    case "openai":
      for await (const ev of suggestReplyOpenai({
        transcript: rest.transcript,
        clinicContext: rest.clinicContext,
        dialect: rest.dialect,
      })) {
        yield ev;
      }
      return;
    default: {
      const _exhaustive: never = config;
      void _exhaustive;
      throw new Error("unknown suggest provider");
    }
  }
}

// Convenience: run all four dispatchers from a `ProviderConfig` blob.
export const dispatchers = {
  streamStt,
  translate,
  synthesize,
  suggestReply,
};

export type { ProviderConfig };
