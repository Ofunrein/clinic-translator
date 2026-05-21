// Track C2. Client-side hooks over /api/settings.
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import type { ClinicSettings } from "@/lib/db/schema";
import type { ClinicSettingsPatch } from "@/lib/settings";

export type ClientClinicSettings = Omit<ClinicSettings, "updatedAt"> & {
  updatedAt: string;
};

const SETTINGS_KEY = ["clinic-settings"] as const;

async function fetchSettings(): Promise<ClientClinicSettings> {
  const res = await fetch("/api/settings", {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `settings fetch failed (${res.status})`);
  }
  const json = (await res.json()) as { settings: ClientClinicSettings };
  return json.settings;
}

async function patchSettings(
  patch: ClinicSettingsPatch,
): Promise<ClientClinicSettings> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `settings patch failed (${res.status})`);
  }
  const json = (await res.json()) as { settings: ClientClinicSettings };
  return json.settings;
}

export function useClinicSettings(): UseQueryResult<ClientClinicSettings, Error> {
  return useQuery<ClientClinicSettings, Error>({
    queryKey: SETTINGS_KEY,
    queryFn: fetchSettings,
    staleTime: 30_000,
  });
}

export function useUpdateClinicSettings(): UseMutationResult<
  ClientClinicSettings,
  Error,
  ClinicSettingsPatch
> {
  const qc = useQueryClient();
  return useMutation<ClientClinicSettings, Error, ClinicSettingsPatch>({
    mutationFn: patchSettings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: SETTINGS_KEY });
      const prev = qc.getQueryData<ClientClinicSettings>(SETTINGS_KEY);
      if (prev) {
        qc.setQueryData<ClientClinicSettings>(SETTINGS_KEY, {
          ...prev,
          ...(patch as Partial<ClientClinicSettings>),
        });
      }
      return { prev } as unknown as ClinicSettingsPatch;
    },
    onSuccess: (next) => {
      qc.setQueryData<ClientClinicSettings>(SETTINGS_KEY, next);
    },
    onError: (_err, _vars, ctx) => {
      const restored = (ctx as unknown as { prev?: ClientClinicSettings } | undefined)?.prev;
      if (restored) qc.setQueryData<ClientClinicSettings>(SETTINGS_KEY, restored);
    },
  });
}

/**
 * Track C1's seam — the AI-assist toggle source of truth lives in
 * `clinic_settings.ai_assist_enabled`. This hook reads it via the same
 * cache so C1 doesn't fetch a second time.
 *
 * Returns `true` until settings load (optimistic — matches C1's default).
 */
export function useAiAssistEnabled(): boolean {
  const q = useClinicSettings();
  if (q.data) return q.data.aiAssistEnabled;
  return true;
}
