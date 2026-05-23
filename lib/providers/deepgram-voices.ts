// Deepgram Aura-2 Spanish TTS voices (see developers.deepgram.com/docs/tts-models).

export interface DeepgramEsVoice {
  id: string;
  name: string;
  region: string;
  trait: string;
}

/** All Aura-2 Spanish voices supported by Deepgram. */
export const DEEPGRAM_AURA_ES_VOICES: readonly DeepgramEsVoice[] = [
  { id: "aura-2-javier-es", name: "Javier", region: "Mexican", trait: "professional" },
  { id: "aura-2-estrella-es", name: "Estrella", region: "Mexican", trait: "warm" },
  { id: "aura-2-olivia-es", name: "Olivia", region: "Mexican", trait: "casual" },
  { id: "aura-2-sirio-es", name: "Sirio", region: "Mexican", trait: "baritone" },
  { id: "aura-2-luciano-es", name: "Luciano", region: "Mexican", trait: "energetic" },
  { id: "aura-2-valerio-es", name: "Valerio", region: "Mexican", trait: "deep" },
  { id: "aura-2-aquila-es", name: "Aquila", region: "Latin American", trait: "expressive" },
  { id: "aura-2-selena-es", name: "Selena", region: "Latin American", trait: "friendly" },
  { id: "aura-2-celeste-es", name: "Celeste", region: "Colombian", trait: "energetic" },
  { id: "aura-2-gloria-es", name: "Gloria", region: "Colombian", trait: "natural" },
  { id: "aura-2-antonia-es", name: "Antonia", region: "Argentine", trait: "friendly" },
  { id: "aura-2-nestor-es", name: "Nestor", region: "Peninsular", trait: "professional" },
  { id: "aura-2-alvaro-es", name: "Alvaro", region: "Peninsular", trait: "clear" },
  { id: "aura-2-carina-es", name: "Carina", region: "Peninsular", trait: "confident" },
  { id: "aura-2-diana-es", name: "Diana", region: "Peninsular", trait: "expressive" },
  { id: "aura-2-agustina-es", name: "Agustina", region: "Peninsular", trait: "calm" },
  { id: "aura-2-silvia-es", name: "Silvia", region: "Peninsular", trait: "warm" },
] as const;

export function deepgramEsVoiceLabel(v: DeepgramEsVoice): string {
  return `${v.name} — ${v.region}, ${v.trait}`;
}

export const DEEPGRAM_AURA_ES_VOICE_IDS = new Set(
  DEEPGRAM_AURA_ES_VOICES.map((v) => v.id),
);

export function isDeepgramEsVoiceId(voice: string): boolean {
  return DEEPGRAM_AURA_ES_VOICE_IDS.has(voice);
}

/** Short label for UI (StatusPill, etc.) from a TTS voice id. */
export function resolveTtsVoiceLabel(voiceId: string): string {
  const trimmed = voiceId.trim();
  if (!trimmed) return "Voice";

  const dg = DEEPGRAM_AURA_ES_VOICES.find((v) => v.id === trimmed);
  if (dg) return dg.name;

  const chirp = trimmed.match(/Chirp[^-]*-(?:HD-)?([A-Za-z]+)$/i);
  if (chirp?.[1]) return chirp[1];

  if (trimmed.startsWith("aura-2-") && trimmed.endsWith("-es")) {
    const slug = trimmed.slice("aura-2-".length, -"-es".length);
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  const tail = trimmed.split("-").pop();
  return tail && tail.length > 0
    ? tail.charAt(0).toUpperCase() + tail.slice(1)
    : trimmed;
}

/** Voice groups for the settings dropdown. */
export const DEEPGRAM_AURA_ES_VOICE_GROUPS: ReadonlyArray<{
  label: string;
  voices: readonly DeepgramEsVoice[];
}> = [
  {
    label: "Mexican",
    voices: DEEPGRAM_AURA_ES_VOICES.filter((v) => v.region === "Mexican"),
  },
  {
    label: "Latin American",
    voices: DEEPGRAM_AURA_ES_VOICES.filter((v) => v.region === "Latin American"),
  },
  {
    label: "Colombian",
    voices: DEEPGRAM_AURA_ES_VOICES.filter((v) => v.region === "Colombian"),
  },
  {
    label: "Argentine",
    voices: DEEPGRAM_AURA_ES_VOICES.filter((v) => v.region === "Argentine"),
  },
  {
    label: "Peninsular (Spain)",
    voices: DEEPGRAM_AURA_ES_VOICES.filter((v) => v.region === "Peninsular"),
  },
];
