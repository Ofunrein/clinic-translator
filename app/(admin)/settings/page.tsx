"use client";

// Track C2. Vapi-dashboard-style settings page.
//
// Sections (top to bottom):
//   - Live cost estimator
//   - Latency-mode preset cards
//   - STT / Translate / TTS / Suggest pickers
//   - AI Assist controls
//   - Clinic info (name/hours/dialect/escalation)
//   - Recording + retention
//   - Glossary editor
//   - Save / Reset
//
// All state is driven by TanStack Query against /api/settings; PATCH is
// optimistic with an automatic rollback on failure.

import * as React from "react";
import {
  useClinicSettings,
  useUpdateClinicSettings,
  type ClientClinicSettings,
} from "@/lib/hooks/useClinicSettings";
import {
  PROVIDER_REGISTRY,
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
  SelectItem,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";
import { GlossaryEditor } from "./_glossary";

// ---------------------------------------------------------------------------
// Cost estimator — rough per-5-min-call price computed from catalog entries.
// ---------------------------------------------------------------------------

interface CostBreakdown {
  total: number;
  parts: ReadonlyArray<{ label: string; cost: number }>;
}

function estimateCost(cfg: ProviderConfig): CostBreakdown {
  // Assumptions: 5-minute call, ~750 words STT, ~3 patient + 3 staff turns.
  // STT priced per 1k chars (transcribed), translate per 1k char in/out,
  // TTS per 1k chars, suggest per 1k char in/out.
  const sttChars = 4500;
  const translateChars = 4500;
  const ttsChars = 1500;
  const suggestChars = 2000;

  const sttEntry = getCatalogEntry("stt", cfg.stt.provider);
  const sttModel = sttEntry?.models.find((m) => m.id === cfg.stt.model);
  const sttCost = ((sttModel?.costPer1k ?? 0) * sttChars) / 1000;

  const trEntry = getCatalogEntry("translate", cfg.translate.provider);
  const trModel = trEntry?.models.find((m) => m.id === cfg.translate.model);
  const trCost = ((trModel?.costPer1k ?? 0) * translateChars) / 1000;

  const ttsEntry = getCatalogEntry("tts", cfg.tts.provider);
  const ttsVoice = ttsEntry?.voices.find(
    (v) => v.id === cfg.tts.voice && v.engine === cfg.tts.engine,
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

  // Local draft state — mirror server, edits PATCH on save.
  const [draft, setDraft] = React.useState<ClientClinicSettings | null>(null);

  React.useEffect(() => {
    if (settingsQ.data) setDraft(settingsQ.data);
  }, [settingsQ.data]);

  if (!draft || !settingsQ.data) {
    return (
      <main className="mx-auto max-w-4xl p-6">
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
      escalationRules: draft.escalationRules as EscalationRules,
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

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Cost estimator strip */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <div className="text-sm text-muted-foreground">Per 5-min call</div>
            <div className="text-2xl font-semibold">{formatCents(cost.total)}</div>
          </div>
          <div className="flex gap-2 text-xs">
            {cost.parts.map((p) => (
              <Badge key={p.label} variant="secondary">
                {p.label}: {formatCents(p.cost)}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={"providers"}
        onValueChange={() => {
          /* visual tabs only; state is one form */
        }}
      >
        <TabsList>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="ai">AI Assist</TabsTrigger>
          <TabsTrigger value="clinic">Clinic</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="glossary">Glossary</TabsTrigger>
        </TabsList>
        <TabsContent value="providers" className="space-y-4">
          <LatencyModeCard
            value={cfg.latencyMode}
            onChange={(mode) => {
              const preset = applyPreset(mode);
              setProvider(preset);
            }}
          />
          <SttCard value={cfg.stt} onChange={(stt) => setProvider({ stt })} />
          <TranslateCard
            value={cfg.translate}
            onChange={(translate) => setProvider({ translate })}
          />
          <TtsCard value={cfg.tts} onChange={(tts) => setProvider({ tts })} />
          <SuggestCard
            value={cfg.suggest}
            onChange={(suggest) => setProvider({ suggest })}
          />
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
        </TabsContent>
        <TabsContent value="clinic" className="space-y-4">
          <ClinicCard
            name={draft.clinicName}
            hours={draft.clinicHours}
            dialect={draft.dialect}
            onChange={(p) => setDraft({ ...draft, ...p })}
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

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onReset}>
          Reset to defaults
        </Button>
        <div className="flex items-center gap-2">
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
    fast: { title: "Fast", sub: "Cartesia + Haiku 4.5", p50: "~600 ms" },
    balanced: {
      title: "Balanced (recommended)",
      sub: "Polly Generative + Haiku 4.5",
      p50: "~900 ms",
    },
    accurate: {
      title: "Accurate",
      sub: "Chirp 3 HD + Sonnet 4.6",
      p50: "~1.4 s",
    },
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latency mode</CardTitle>
        <CardDescription>
          Snap all four providers to a known-good combo. Per-call cost is
          re-computed live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
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
// Section: STT
// ---------------------------------------------------------------------------

function ProviderWarning({ provider, kind }: { provider: string; kind: "stt" | "translate" | "tts" | "suggest" }): React.JSX.Element | null {
  const entry = getCatalogEntry(kind, provider);
  if (!entry || entry.baaTier === "covered") return null;
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-yellow-600" />
      <div>
        <div className="font-medium">
          BAA tier: {entry.baaTier === "enterprise-only" ? "enterprise only" : "no BAA available"}
        </div>
        {entry.notes ? <div className="text-muted-foreground">{entry.notes}</div> : null}
      </div>
    </div>
  );
}

function SttCard({
  value,
  onChange,
}: {
  value: SttProvider;
  onChange: (next: SttProvider) => void;
}): React.JSX.Element {
  const providers = Object.keys(PROVIDER_REGISTRY.stt);
  const entry = getCatalogEntry("stt", value.provider);
  return (
    <Card>
      <CardHeader>
        <CardTitle>STT</CardTitle>
        <CardDescription>Transcribe Spanish patient audio in real time.</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        <Select
          value={value.provider}
          onValueChange={(p) => {
            const e = getCatalogEntry("stt", p);
            const m = e?.models[0]?.id ?? "";
            onChange({ provider: p as SttProvider["provider"], model: m, language: "es" });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {PROVIDER_REGISTRY.stt[p].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={value.model}
          onValueChange={(model) => onChange({ ...value, model })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(entry?.models ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={value.language ?? "es"} onValueChange={(language) => onChange({ ...value, language })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="es">Spanish (es)</SelectItem>
          </SelectContent>
        </Select>
        <div className="col-span-3">
          <ProviderWarning provider={value.provider} kind="stt" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Translate
// ---------------------------------------------------------------------------

function TranslateCard({
  value,
  onChange,
}: {
  value: TranslateProvider;
  onChange: (next: TranslateProvider) => void;
}): React.JSX.Element {
  const providers = Object.keys(PROVIDER_REGISTRY.translate);
  const entry = getCatalogEntry("translate", value.provider);
  const model = entry?.models.find((m) => m.id === value.model);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Translate model</CardTitle>
        <CardDescription>
          Translates patient ES → staff EN and staff EN → patient ES.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Select
          value={value.provider}
          onValueChange={(p) => {
            const e = getCatalogEntry("translate", p);
            const m = e?.models[0]?.id ?? "";
            onChange({ provider: p as TranslateProvider["provider"], model: m });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {PROVIDER_REGISTRY.translate[p].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={value.model} onValueChange={(m) => onChange({ ...value, model: m })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(entry?.models ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="col-span-2 flex flex-wrap gap-2 text-xs">
          {model?.costPer1k !== undefined ? (
            <Badge variant="secondary">${(model.costPer1k * 1000).toFixed(2)} / 1M chars</Badge>
          ) : null}
          {model?.baseLatencyMs !== undefined ? (
            <Badge variant="secondary">~{model.baseLatencyMs} ms</Badge>
          ) : null}
        </div>
        <div className="col-span-2">
          <ProviderWarning provider={value.provider} kind="translate" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: TTS
// ---------------------------------------------------------------------------

function TtsCard({
  value,
  onChange,
}: {
  value: TtsProvider;
  onChange: (next: TtsProvider) => void;
}): React.JSX.Element {
  const providers = Object.keys(PROVIDER_REGISTRY.tts);
  const entry = getCatalogEntry("tts", value.provider);
  const [previewing, setPreviewing] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const onPreview = async (): Promise<void> => {
    setPreviewing(true);
    try {
      const res = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: value }),
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "preview failed");
      }
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>TTS voice</CardTitle>
        <CardDescription>
          Speaks staff replies back to the patient in Spanish.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        <Select
          value={value.provider}
          onValueChange={(p) => {
            const e = getCatalogEntry("tts", p);
            const v = e?.voices[0];
            if (!v) return;
            onChange({
              provider: p as TtsProvider["provider"],
              voice: v.id,
              engine: v.engine as TtsProvider["engine"],
            } as TtsProvider);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {PROVIDER_REGISTRY.tts[p].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={`${value.voice}::${value.engine}`}
          onValueChange={(v) => {
            const [voice, engine] = v.split("::");
            onChange({ ...value, voice, engine } as TtsProvider);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(entry?.voices ?? []).map((v) => (
              <SelectItem key={`${v.id}::${v.engine}`} value={`${v.id}::${v.engine}`}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={onPreview} disabled={previewing} variant="outline">
          {previewing ? "Loading…" : "Preview voice"}
        </Button>
        <div className="col-span-3">
          <ProviderWarning provider={value.provider} kind="tts" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Suggest
// ---------------------------------------------------------------------------

function SuggestCard({
  value,
  onChange,
}: {
  value: SuggestProvider;
  onChange: (next: SuggestProvider) => void;
}): React.JSX.Element {
  const providers = Object.keys(PROVIDER_REGISTRY.suggest);
  const entry = getCatalogEntry("suggest", value.provider);
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Assist model</CardTitle>
        <CardDescription>
          Drafts the staff reply suggestion. Default is the same model as
          translate; override here to use a stronger model.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Select
          value={value.provider}
          onValueChange={(p) => {
            const e = getCatalogEntry("suggest", p);
            const m = e?.models[0]?.id ?? "";
            onChange({ provider: p as SuggestProvider["provider"], model: m });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p} value={p}>
                {PROVIDER_REGISTRY.suggest[p].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={value.model} onValueChange={(m) => onChange({ ...value, model: m })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(entry?.models ?? []).map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
// Section: Clinic
// ---------------------------------------------------------------------------

function ClinicCard({
  name,
  hours,
  dialect,
  onChange,
}: {
  name: string;
  hours: string;
  dialect: "mx" | "cen" | "car" | "other";
  onChange: (p: { clinicName?: string; clinicHours?: string; dialect?: "mx" | "cen" | "car" | "other" }) => void;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinic info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-sm font-medium">Name</label>
          <Input value={name} onChange={(e) => onChange({ clinicName: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium">Hours</label>
          <Textarea
            value={hours}
            onChange={(e) => onChange({ clinicHours: e.target.value })}
            rows={3}
          />
        </div>
        <div>
          <label className="text-sm font-medium">Default dialect</label>
          <Select
            value={dialect}
            onValueChange={(v) =>
              onChange({ dialect: v as "mx" | "cen" | "car" | "other" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mx">Mexican (mx)</SelectItem>
              <SelectItem value="cen">Central American (cen)</SelectItem>
              <SelectItem value="car">Caribbean (car)</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
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
