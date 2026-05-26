"use client";

// Track C2. Settings page — Deepgram voice + latency presets.
//
// Sections:
//   - Live cost estimator
//   - Migration banner (legacy multi-vendor configs)
//   - Latency-mode preset cards
//   - Deepgram STT/TTS pickers
//   - Read-only translation/suggest (tied to preset)
//   - AI Assist, clinic, retention, glossary tabs
//
// All state is driven by TanStack Query against /api/settings; PATCH is
// optimistic with an automatic rollback on failure.

import * as React from "react";
import {
  useClinicSettings,
  useUpdateClinicSettings,
  type ClientClinicSettings,
} from "@/lib/hooks/useClinicSettings";
import { useQueryClient } from "@tanstack/react-query";
import {
  getCatalogEntry,
} from "@/lib/providers/registry";
import { LATENCY_PRESETS, applyPreset } from "@/lib/providers/presets";
import type {
  LatencyMode,
  ProviderConfig,
  SttProvider,
  TranslateProvider,
  TtsProvider,
  SuggestProvider,
  EscalationRules,
} from "@/lib/providers/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AlertTriangle } from "lucide-react";
import { AppNav } from "@/components/AppNav";
import { GlossaryEditor } from "./_glossary";
import { ClinicKnowledgeTab } from "./_clinic-knowledge";
import { normalizeEscalationRules } from "@/lib/escalation-rules";
import {
  DEEPGRAM_AURA_ES_VOICE_GROUPS,
  DEEPGRAM_AURA_ES_VOICES,
  DEFAULT_DEEPGRAM_TTS_VOICE,
  deepgramEsVoiceLabel,
} from "@/lib/providers/deepgram-voices";

const DEEPGRAM_STT_MODELS = [
  { id: "nova-3", label: "Nova-3 Spanish (streaming)" },
  { id: "nova-2", label: "Nova-2 Spanish" },
  {
    id: "flux-general-multi",
    label: "Flux General Multilingual — better turn detection",
  },
] as const;

const DEFAULT_DEEPGRAM_VOICE = DEFAULT_DEEPGRAM_TTS_VOICE;

function isSupportedStack(cfg: ProviderConfig): boolean {
  return (
    cfg.stt.provider === "deepgram" &&
    cfg.tts.provider === "deepgram" &&
    cfg.translate.provider === "groq" &&
    cfg.suggest.provider === "groq"
  );
}

function voiceCostConfig(cfg: ProviderConfig): ProviderConfig {
  if (cfg.stt.provider === "deepgram" && cfg.tts.provider === "deepgram") {
    return cfg;
  }
  const balanced = applyPreset("balanced");
  return { ...cfg, stt: balanced.stt, tts: balanced.tts };
}

// ---------------------------------------------------------------------------
// Cost estimator — rough per-5-min-call price computed from catalog entries.
// ---------------------------------------------------------------------------

interface CostBreakdown {
  total: number;
  parts: ReadonlyArray<{ label: string; cost: number }>;
}

function estimateCost(cfg: ProviderConfig): CostBreakdown {
  const voice = voiceCostConfig(cfg);
  const sttChars = 4500;
  const translateChars = 4500;
  const ttsChars = 1500;
  const suggestChars = 2000;

  const sttEntry = getCatalogEntry("stt", voice.stt.provider);
  const sttModel = sttEntry?.models.find((m) => m.id === voice.stt.model);
  const sttCost = ((sttModel?.costPer1k ?? 0) * sttChars) / 1000;

  const trEntry = getCatalogEntry("translate", cfg.translate.provider);
  const trModel = trEntry?.models.find((m) => m.id === cfg.translate.model);
  const trCost = ((trModel?.costPer1k ?? 0) * translateChars) / 1000;

  const ttsEntry = getCatalogEntry("tts", voice.tts.provider);
  const ttsVoice = ttsEntry?.voices.find(
    (v) => v.id === voice.tts.voice && v.engine === voice.tts.engine,
  );
  const ttsCost = ((ttsVoice?.costPer1kChars ?? 0) * ttsChars) / 1000;

  const sugEntry = getCatalogEntry("suggest", cfg.suggest.provider);
  const sugModel = sugEntry?.models.find((m) => m.id === cfg.suggest.model);
  const sugCost = ((sugModel?.costPer1k ?? 0) * suggestChars) / 1000;

  return {
    total: sttCost + trCost + ttsCost + sugCost,
    parts: [
      { label: "STT", cost: sttCost },
      { label: "Translate", cost: trCost },
      { label: "TTS", cost: ttsCost },
      { label: "Suggest", cost: sugCost },
    ],
  };
}

function formatCents(usd: number): string {
  return `$${usd.toFixed(3)}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage(): React.JSX.Element {
  const settingsQ = useClinicSettings();
  const update = useUpdateClinicSettings();
  const qc = useQueryClient();

  const [draft, setDraft] = React.useState<ClientClinicSettings | null>(null);
  const [tab, setTab] = React.useState("providers");
  const [sectionSaving, setSectionSaving] = React.useState(false);
  const [migrating, setMigrating] = React.useState(false);
  const [migrateError, setMigrateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (settingsQ.data) setDraft(settingsQ.data);
  }, [settingsQ.data]);

  if (!draft || !settingsQ.data) {
    return (
      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        {settingsQ.isError ? (
          <div className="rounded-md border border-destructive p-4 text-destructive">
            Failed to load settings: {settingsQ.error.message}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Loading settings…</div>
        )}
      </main>
    );
  }

  const cfg: ProviderConfig = {
    stt: draft.stt as SttProvider,
    translate: draft.translate as TranslateProvider,
    tts: draft.tts as TtsProvider,
    suggest: draft.suggest as SuggestProvider,
    latencyMode: draft.latencyMode,
    realtimeMode: draft.realtimeMode,
  };

  const cost = estimateCost(cfg);
  const needsMigration = !isSupportedStack(cfg);

  const setProvider = (next: Partial<ProviderConfig>): void => {
    setDraft({
      ...draft,
      ...(next.stt ? { stt: next.stt } : {}),
      ...(next.translate ? { translate: next.translate } : {}),
      ...(next.tts ? { tts: next.tts } : {}),
      ...(next.suggest ? { suggest: next.suggest } : {}),
      ...(next.latencyMode ? { latencyMode: next.latencyMode } : {}),
      ...(next.realtimeMode ? { realtimeMode: next.realtimeMode } : {}),
    });
  };

  const onSave = (): void => {
    if (!draft) return;
    update.mutate({
      stt: draft.stt as SttProvider,
      translate: draft.translate as TranslateProvider,
      tts: draft.tts as TtsProvider,
      suggest: draft.suggest as SuggestProvider,
      latencyMode: draft.latencyMode,
      realtimeMode: draft.realtimeMode,
      aiAssistEnabled: draft.aiAssistEnabled,
      recordingEnabled: draft.recordingEnabled,
      retentionDaysTranscripts: draft.retentionDaysTranscripts,
      retentionDaysAudio: draft.retentionDaysAudio,
      dialect: draft.dialect,
      clinicName: draft.clinicName,
      clinicHours: draft.clinicHours,
      clinicServices: draft.clinicServices,
      clinicAfterHours: draft.clinicAfterHours,
      clinicTransferPhone: draft.clinicTransferPhone,
      clinicPolicyNotes: draft.clinicPolicyNotes,
      clinicFaqBullets: draft.clinicFaqBullets,
      escalationRules: draft.escalationRules as EscalationRules,
    });
  };

  const onSaveKnowledgeSection = (patch: Parameters<typeof update.mutate>[0]): void => {
    setSectionSaving(true);
    update.mutate(patch, {
      onSettled: () => setSectionSaving(false),
    });
  };

  const onReset = (): void => {
    const balanced = applyPreset("balanced");
    setDraft({
      ...draft,
      stt: balanced.stt,
      translate: balanced.translate,
      tts: balanced.tts,
      suggest: balanced.suggest,
      latencyMode: balanced.latencyMode,
      realtimeMode: balanced.realtimeMode,
    });
  };

  const onMigrateDeepgram = async (): Promise<void> => {
    setMigrating(true);
    setMigrateError(null);
    try {
      const res = await fetch("/api/settings/migrate-deepgram", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `migration failed (${res.status})`);
      }
      const json = (await res.json()) as { settings: ClientClinicSettings };
      qc.setQueryData(["clinic-settings"], json.settings);
      setDraft(json.settings);
    } catch (err) {
      setMigrateError(err instanceof Error ? err.message : "migration failed");
    } finally {
      setMigrating(false);
    }
  };

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:space-y-6 sm:p-6">
      <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold sm:text-xl">Settings</h1>
        <AppNav />
      </header>
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Per 5-min call</div>
            <div className="text-xl font-semibold sm:text-2xl">{formatCents(cost.total)}</div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {cost.parts.map((p) => (
              <Badge key={p.label} variant="secondary">
                {p.label}: {formatCents(p.cost)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {needsMigration ? (
        <div className="flex flex-col gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
            <div>
              <div className="font-medium">Stack is not Deepgram + Groq</div>
              <div className="text-muted-foreground">
                Voice uses Deepgram Nova + Aura; translation and suggestions use
                Groq. One click resets to the balanced preset and saves.
              </div>
              {migrateError ? (
                <div className="mt-1 text-destructive">{migrateError}</div>
              ) : null}
            </div>
          </div>
          <Button onClick={onMigrateDeepgram} disabled={migrating}>
            {migrating ? "Migrating…" : "Switch to Deepgram + Groq"}
          </Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full max-w-full flex-wrap justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="providers">Voice</TabsTrigger>
          <TabsTrigger value="ai">AI Assist</TabsTrigger>
          <TabsTrigger value="clinic">Knowledge</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="glossary">Glossary</TabsTrigger>
        </TabsList>
        <TabsContent value="providers" className="space-y-4">
          <LatencyModeCard
            value={cfg.latencyMode}
            onChange={(mode) => {
              const preset = applyPreset(mode);
              setProvider({
                ...preset,
                tts:
                  cfg.tts.provider === preset.tts.provider
                    ? cfg.tts
                    : preset.tts,
              });
            }}
          />
          <DeepgramVoiceCard
            stt={cfg.stt}
            tts={cfg.tts}
            onSttChange={(stt) => setProvider({ stt })}
            onTtsChange={(tts) => setProvider({ tts })}
          />
          <TranslationCard translate={cfg.translate} suggest={cfg.suggest} />
        </TabsContent>
        <TabsContent value="ai" className="space-y-4">
          <AiAssistCard
            enabled={draft.aiAssistEnabled}
            escalation={draft.escalationRules as EscalationRules}
            onEnabledChange={(v) => setDraft({ ...draft, aiAssistEnabled: v })}
            onEscalationChange={(rules) =>
              setDraft({ ...draft, escalationRules: rules })
            }
          />
          <StaffPreviewCard
            escalation={draft.escalationRules as EscalationRules}
            onEscalationChange={(rules) =>
              setDraft({ ...draft, escalationRules: rules })
            }
          />
        </TabsContent>
        <TabsContent value="clinic" className="space-y-4">
          <ClinicKnowledgeTab
            draft={{
              clinicName: draft.clinicName,
              clinicHours: draft.clinicHours,
              clinicAfterHours: draft.clinicAfterHours,
              clinicTransferPhone: draft.clinicTransferPhone,
              clinicPolicyNotes: draft.clinicPolicyNotes,
              clinicServices: Array.isArray(draft.clinicServices)
                ? draft.clinicServices
                : [],
              clinicFaqBullets: Array.isArray(draft.clinicFaqBullets)
                ? draft.clinicFaqBullets
                : [],
              dialect: draft.dialect,
            }}
            onChange={(p) => setDraft({ ...draft, ...p })}
            onSaveSection={onSaveKnowledgeSection}
            pending={sectionSaving || update.isPending}
            sectionError={update.isError ? update.error.message : null}
          />
        </TabsContent>
        <TabsContent value="data" className="space-y-4">
          <RetentionCard
            recording={draft.recordingEnabled}
            transcriptDays={draft.retentionDaysTranscripts}
            audioDays={draft.retentionDaysAudio}
            onChange={(p) => setDraft({ ...draft, ...p })}
          />
        </TabsContent>
        <TabsContent value="glossary">
          <GlossaryEditor />
        </TabsContent>
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onReset} className="w-full sm:w-auto">
          Reset to defaults
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {update.isError ? (
            <span className="text-sm text-destructive">
              {update.error.message}
            </span>
          ) : null}
          <Button onClick={onSave} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Section: latency mode
// ---------------------------------------------------------------------------

function LatencyModeCard({
  value,
  onChange,
}: {
  value: LatencyMode;
  onChange: (next: LatencyMode) => void;
}): React.JSX.Element {
  const modes: LatencyMode[] = ["fast", "balanced", "accurate"];
  const labels: Record<LatencyMode, { title: string; sub: string; p50: string }> = {
    fast: { title: "Fast", sub: "Nova-3 STT · Groq 8B · keeps selected voice", p50: "~600 ms" },
    balanced: {
      title: "Balanced (recommended)",
      sub: "Nova-3 STT · Groq 70B · keeps selected voice",
      p50: "~900 ms",
    },
    accurate: {
      title: "Accurate",
      sub: "Nova-3 STT · Groq 70B · keeps selected voice",
      p50: "~1.1 s",
    },
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latency mode</CardTitle>
        <CardDescription>
          Switch translation and suggestion models to a known-good speed/quality
          combo. Your selected TTS voice is kept unless the voice provider changes.
          Per-call cost is re-computed live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {modes.map((m) => {
            const active = m === value;
            const preset = LATENCY_PRESETS[m];
            const cost = estimateCost(preset);
            return (
              <button
                key={m}
                onClick={() => onChange(m)}
                className={
                  "flex flex-col rounded-md border p-3 text-left transition-colors " +
                  (active
                    ? "border-primary bg-primary/5"
                    : "hover:border-foreground/40")
                }
                aria-pressed={active}
              >
                <div className="text-sm font-semibold">{labels[m].title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {labels[m].sub}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span>{labels[m].p50}</span>
                  <span>{formatCents(cost.total)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Deepgram voice (STT + TTS)
// ---------------------------------------------------------------------------

function DeepgramVoiceCard({
  stt,
  tts,
  onSttChange,
  onTtsChange,
}: {
  stt: SttProvider;
  tts: TtsProvider;
  onSttChange: (next: SttProvider) => void;
  onTtsChange: (next: TtsProvider) => void;
}): React.JSX.Element {
  const sttModel =
    stt.provider === "deepgram" ? stt.model : DEEPGRAM_STT_MODELS[0].id;
  const ttsVoice =
    tts.provider === "deepgram" ? tts.voice : DEFAULT_DEEPGRAM_VOICE;
  const [previewing, setPreviewing] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const previewAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const cleanupPreviewAudio = (): void => {
    previewAudioRef.current?.pause();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    previewAudioRef.current = null;
  };

  const onPreview = async (): Promise<void> => {
    setPreviewing(true);
    setPreviewError(null);
    cleanupPreviewAudio();
    const config: TtsProvider = {
      provider: "deepgram",
      voice: ttsVoice,
      engine: "aura-2",
    };
    try {
      const res = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Preview failed (${res.status})`);
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) {
        throw new Error("Preview returned empty audio");
      }
      const mime = res.headers.get("content-type") ?? "audio/mpeg";
      const blob = new Blob([buf], { type: mime });
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = cleanupPreviewAudio;
      audio.onerror = () => {
        setPreviewError("Could not play audio in this browser");
        cleanupPreviewAudio();
      };
      await audio.play();
    } catch (err) {
      cleanupPreviewAudio();
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deepgram voice</CardTitle>
        <CardDescription>
          One API key powers Spanish speech-to-text (Nova) and all available
          Aura-2 Spanish text-to-speech voices. Pick a Mexican voice for most
          patients, a code-switching voice for mixed English/Spanish, or another
          regional Spanish voice when needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Speech-to-text model</label>
          <Select
            value={sttModel}
            onValueChange={(model) =>
              onSttChange({ provider: "deepgram", model, language: "es" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEEPGRAM_STT_MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Text-to-speech voice</label>
          <Select
            value={ttsVoice}
            onValueChange={(voice) =>
              onTtsChange({ provider: "deepgram", voice, engine: "aura-2" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEEPGRAM_AURA_ES_VOICE_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.voices.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {deepgramEsVoiceLabel(v)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Button onClick={() => void onPreview()} disabled={previewing} variant="outline">
            {previewing ? "Loading…" : "Preview voice"}
          </Button>
          {previewError ? (
            <p className="text-sm text-destructive">{previewError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Plays a short Spanish sample using your saved Deepgram key.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Translation (read-only — tied to latency mode)
// ---------------------------------------------------------------------------

function TranslationCard({
  translate,
  suggest,
}: {
  translate: TranslateProvider;
  suggest: SuggestProvider;
}): React.JSX.Element {
  const trEntry = getCatalogEntry("translate", translate.provider);
  const trModel = trEntry?.models.find((m) => m.id === translate.model);
  const sugEntry = getCatalogEntry("suggest", suggest.provider);
  const sugModel = sugEntry?.models.find((m) => m.id === suggest.model);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Translation &amp; suggestions</CardTitle>
        <CardDescription>
          Mexican Spanish Aura voices for patient playback. Translation and AI
          suggestions run on Groq — change latency mode above to swap models.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Translate:</span>
          <Badge variant="secondary">
            {trEntry?.name ?? translate.provider} — {trModel?.label ?? translate.model}
          </Badge>
          {trModel?.costPer1k !== undefined ? (
            <Badge variant="outline">
              ${(trModel.costPer1k * 1000).toFixed(2)} / 1M chars
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">AI Assist:</span>
          <Badge variant="secondary">
            {sugEntry?.name ?? suggest.provider} — {sugModel?.label ?? suggest.model}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: AI Assist
// ---------------------------------------------------------------------------

function AiAssistCard({
  enabled,
  escalation,
  onEnabledChange,
  onEscalationChange,
}: {
  enabled: boolean;
  escalation: EscalationRules;
  onEnabledChange: (v: boolean) => void;
  onEscalationChange: (rules: EscalationRules) => void;
}): React.JSX.Element {
  const [keywordInput, setKeywordInput] = React.useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Assist</CardTitle>
        <CardDescription>
          Reply suggestions are drafted by the model and reviewed by staff
          before they speak. Suggestions are never auto-sent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Enable AI Assist</div>
            <div className="text-xs text-muted-foreground">
              When off, the suggest pane is hidden.
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Confidence floor</div>
            <Badge variant="secondary">{escalation.confidenceFloor.toFixed(2)}</Badge>
          </div>
          <Slider
            value={Math.round(escalation.confidenceFloor * 100)}
            onValueChange={(n) =>
              onEscalationChange({ ...escalation, confidenceFloor: n / 100 })
            }
            min={0}
            max={100}
            step={1}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            Below this confidence the UI flags the suggestion as low-confidence.
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">Escalate keywords</div>
          <div className="flex flex-wrap gap-1">
            {escalation.keywords.map((k) => (
              <Badge key={k} variant="secondary" className="cursor-pointer">
                <span>{k}</span>
                <button
                  type="button"
                  onClick={() =>
                    onEscalationChange({
                      ...escalation,
                      keywords: escalation.keywords.filter((x) => x !== k),
                    })
                  }
                  className="ml-1 text-xs"
                  aria-label={`remove ${k}`}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              placeholder="Add keyword (e.g. 'severe pain')"
            />
            <Button
              variant="outline"
              onClick={() => {
                const v = keywordInput.trim().toLowerCase();
                if (!v) return;
                if (escalation.keywords.includes(v)) return;
                onEscalationChange({
                  ...escalation,
                  keywords: [...escalation.keywords, v],
                });
                setKeywordInput("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: staff Spanish preview timing
// ---------------------------------------------------------------------------

function StaffPreviewCard({
  escalation,
  onEscalationChange,
}: {
  escalation: EscalationRules;
  onEscalationChange: (rules: EscalationRules) => void;
}): React.JSX.Element {
  const rules = normalizeEscalationRules(escalation);
  const holdSec = rules.previewHoldSec ?? 10;
  const autoSend = rules.autoSendPreview ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff message preview</CardTitle>
        <CardDescription>
          After you translate English to Spanish, staff review the preview before
          it is spoken to the patient. AI suggestions are never auto-sent — this
          only applies to messages staff explicitly translate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Review time</div>
            <Badge variant="secondary">
              {holdSec <= 0 ? "Manual only" : `${holdSec}s`}
            </Badge>
          </div>
          <Slider
            value={holdSec}
            onValueChange={(n) =>
              onEscalationChange({ ...rules, previewHoldSec: n })
            }
            min={0}
            max={30}
            step={1}
          />
          <div className="mt-1 text-xs text-muted-foreground">
            Seconds to review the Spanish preview. Set to 0 to disable the timer
            (staff must click Send &amp; Speak).
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Auto-send when timer ends</div>
            <div className="text-xs text-muted-foreground">
              Off (default): preview is dismissed when time runs out. On: speaks
              to the patient automatically.
            </div>
          </div>
          <Switch
            checked={autoSend}
            disabled={holdSec <= 0}
            onCheckedChange={(v) =>
              onEscalationChange({ ...rules, autoSendPreview: v })
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Recording / retention
// ---------------------------------------------------------------------------

function RetentionCard({
  recording,
  transcriptDays,
  audioDays,
  onChange,
}: {
  recording: boolean;
  transcriptDays: number;
  audioDays: number;
  onChange: (p: {
    recordingEnabled?: boolean;
    retentionDaysTranscripts?: number;
    retentionDaysAudio?: number;
  }) => void;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recording &amp; retention</CardTitle>
        <CardDescription>
          Audio recording is opt-in. Transcripts default to 7 years.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Record audio</div>
            <div className="text-xs text-muted-foreground">
              Off by default. Enable only if your BAAs cover audio retention.
            </div>
          </div>
          <Switch
            checked={recording}
            onCheckedChange={(v) => onChange({ recordingEnabled: v })}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">Transcript retention</span>
            <Badge variant="secondary">{transcriptDays} days</Badge>
          </div>
          <Slider
            value={transcriptDays}
            onValueChange={(n) => onChange({ retentionDaysTranscripts: n })}
            min={30}
            max={3650}
            step={30}
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">Audio retention</span>
            <Badge variant="secondary">{audioDays} days</Badge>
          </div>
          <Slider
            value={audioDays}
            onValueChange={(n) => onChange({ retentionDaysAudio: n })}
            min={0}
            max={365}
            step={1}
          />
        </div>
      </CardContent>
    </Card>
  );
}
