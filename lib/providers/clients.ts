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

// ----- Translate -----
export interface DispatchTranslateArgs extends TranslateArgs {
  config: TranslateProvider;
}

export async function translate(args: DispatchTranslateArgs): Promise<TranslateResult> {
  const { config, ...rest } = args;
  switch (config.provider) {
    case "bedrock":
      // Existing Bedrock client honors BEDROCK_MODEL_ID env; the dispatcher
      // sets it for the duration of the call so we don't break the test
      // seam in `lib/anthropic`.
      return withEnv("BEDROCK_MODEL_ID", config.model, () => translateBedrock(rest));
    case "vertex-gemini":
      return translateVertex({ ...rest, model: config.model });
    case "azure-openai":
      return translateAzure({ ...rest, model: config.model });
    case "deepl":
      return translateDeepL({ ...rest, model: config.model });
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
      const restore = setEnv("BEDROCK_MODEL_ID", config.model);
      try {
        for await (const ev of suggestReplyBedrock(rest)) {
          yield ev;
        }
      } finally {
        restore();
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
    default: {
      const _exhaustive: never = config;
      void _exhaustive;
      throw new Error("unknown suggest provider");
    }
  }
}

// ----- Helpers -----

function setEnv(key: string, value: string): () => void {
  const prev = process.env[key];
  process.env[key] = value;
  return () => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
}

async function withEnv<T>(
  key: string,
  value: string,
  fn: () => Promise<T>,
): Promise<T> {
  const restore = setEnv(key, value);
  try {
    return await fn();
  } finally {
    restore();
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
