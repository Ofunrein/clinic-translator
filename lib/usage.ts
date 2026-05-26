import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { getCatalogEntry } from "@/lib/providers/registry";

export interface RecordUsageArgs {
  route: "translate" | "suggest" | "tts";
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  ttsChars: number | null;
  sessionId: string | null;
}

function estimateCost(args: RecordUsageArgs): number {
  if (args.route === "tts") {
    const chars = args.ttsChars ?? 0;
    if (chars === 0) return 0;
    const entry = getCatalogEntry("tts", args.provider);
    if (!entry) return 0;
    const voice = entry.voices.find((v) => v.engine === args.model || v.id === args.model);
    const rate = voice?.costPer1kChars ?? 0;
    return (chars * rate) / 1000;
  }
  const totalTokens = (args.promptTokens ?? 0) + (args.completionTokens ?? 0);
  if (totalTokens === 0) return 0;
  const kind = args.route === "suggest" ? "suggest" : "translate";
  const entry = getCatalogEntry(kind, args.provider);
  if (!entry) return 0;
  const modelEntry = entry.models.find((m) => m.id === args.model);
  const rate = modelEntry?.costPer1k ?? 0;
  return (totalTokens * rate) / 1000;
}

export async function recordUsage(args: RecordUsageArgs): Promise<void> {
  try {
    const estimatedCostUsd = estimateCost(args).toFixed(6);
    await db.insert(usageEvents).values({
      sessionId: args.sessionId,
      route: args.route,
      provider: args.provider,
      model: args.model,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      ttsChars: args.ttsChars,
      estimatedCostUsd,
    });
  } catch (err) {
    console.error("[usage] recordUsage failed", err instanceof Error ? err.message : String(err));
  }
}
