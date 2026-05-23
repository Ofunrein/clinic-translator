// Owned by Track B3. Spec §4.1 split-pane shell.
"use client";

import * as React from "react";
import { AppNav } from "@/components/AppNav";
import { ClinicLogo } from "@/components/ClinicLogo";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { PatientPane } from "@/components/PatientPane";
import { StaffPane } from "@/components/StaffPane";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { AudioContextProvider } from "@/lib/audio-context";
import { useSessionStore } from "@/lib/session";
import { persistUtteranceToServer } from "@/lib/transcript-sync";
import type { Urgency } from "@/components/UrgencyFlag";

interface SessionDto {
  id: string;
  startedAt: string;
  urgency: "info" | "routine" | "urgent" | "emergency";
}

interface ApiError {
  code: string;
  message: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let err: ApiError | null = null;
    try {
      err = (await res.json()) as ApiError;
    } catch { /* noop */ }
    throw new Error(err?.message ?? `request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return (await res.json()) as T;
}

function ClinicTranslatorApp(): React.ReactElement {
  const sessionId = useSessionStore((s) => s.sessionId);
  const setSessionId = useSessionStore((s) => s.setSessionId);
  const setStatus = useSessionStore((s) => s.setStatus);
  const reset = useSessionStore((s) => s.reset);
  const hydrate = useSessionStore((s) => s.hydrate);

  const [urgency, setUrgency] = React.useState<Urgency>("routine");

  // Hydrate from `?session=<id>` (spec §7 crash recovery).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const resume = params.get("session");
    if (resume) {
      void hydrate(resume).then(() => {
        setStatus("ready");
      });
    } else {
      setStatus("idle");
    }
  }, [hydrate, setStatus]);

  // Track network online/offline (spec §7).
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = (): void => {
      const cur = useSessionStore.getState().status;
      if (cur === "offline") setStatus("ready");
    };
    const onOffline = (): void => {
      setStatus("offline", "browser is offline");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (typeof navigator !== "undefined" && !navigator.onLine) onOffline();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [setStatus]);

  const session = useQuery<SessionDto | null>({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      return getJson<SessionDto>(`/api/sessions/${sessionId}`);
    },
    enabled: Boolean(sessionId),
    retry: 1,
  });

  const startCall = useMutation({
    mutationFn: async () => {
      return postJson<SessionDto>("/api/sessions", { urgency });
    },
    onSuccess: (s) => {
      setSessionId(s.id);
      setStatus("ready");
      // Reflect in URL so refresh recovery works (spec §7).
      const url = new URL(window.location.href);
      url.searchParams.set("session", s.id);
      window.history.replaceState(null, "", url.toString());
    },
    onError: (err: Error) => {
      setStatus("degraded", `start call: ${err.message}`);
    },
  });

  const endCall = useMutation({
    mutationFn: async () => {
      if (!sessionId) return null;
      return postJson<SessionDto>(`/api/sessions/${sessionId}/end`, {});
    },
    onSettled: async () => {
      const state = useSessionStore.getState();
      if (state.sessionId) {
        for (const u of state.transcript) {
          if (u.isPartial || u.syncedToServer || !u.text.trim()) continue;
          const serverId = await persistUtteranceToServer(state.sessionId, u);
          if (serverId && serverId !== u.id) {
            state.reconcileUtteranceId(u.id, serverId);
          } else if (serverId) {
            state.markUtteranceSynced(u.id);
          }
        }
      }
      reset();
      const url = new URL(window.location.href);
      url.searchParams.delete("session");
      window.history.replaceState(null, "", url.toString());
    },
  });

  const onUrgencyChange = React.useCallback(
    (u: Urgency) => {
      setUrgency(u);
      if (sessionId) {
        // Best-effort PATCH; ignore failure (status pill will surface).
        void fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ urgency: u }),
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "patch failed";
          setStatus("degraded", `urgency update: ${msg}`);
        });
      }
    },
    [sessionId, setStatus],
  );

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2 sm:gap-4 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <ClinicLogo size="sm" className="min-w-0 shrink" />
          {sessionId ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              session {sessionId.slice(0, 8)}
              {session.data?.startedAt ? ` · started ${new Date(session.data.startedAt).toLocaleTimeString()}` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <AppNav />
          <StatusPill voice="Achernar" />
          {sessionId ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => endCall.mutate()}
              disabled={endCall.isPending}
            >
              {endCall.isPending ? "Ending…" : "End Call"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => startCall.mutate()}
              disabled={startCall.isPending}
            >
              {startCall.isPending ? "Starting…" : "Start Call"}
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 divide-y lg:grid-cols-2 lg:grid-rows-1 lg:divide-x lg:divide-y-0">
        <PatientPane
          urgency={urgency}
          onUrgencyChange={onUrgencyChange}
          autoStart={Boolean(sessionId)}
          className="min-h-0"
        />
        <StaffPane className="min-h-0" />
      </div>
    </main>
  );
}

export default function Page(): React.ReactElement {
  // QueryClient is owned here so SSR doesn't share clients across requests.
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AudioContextProvider>
        <ClinicTranslatorApp />
      </AudioContextProvider>
    </QueryClientProvider>
  );
}
