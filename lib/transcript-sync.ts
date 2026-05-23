// Flush local transcript rows to Postgres when translate didn't persist them.
import type { Utterance } from "./session";

export async function persistUtteranceToServer(
  sessionId: string,
  u: Pick<Utterance, "role" | "langPrimary" | "text" | "translation">,
): Promise<string | null> {
  const res = await fetch(`/api/sessions/${sessionId}/utterances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      role: u.role,
      lang: u.langPrimary,
      text: u.text,
      translation: u.translation ?? undefined,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

/** Best-effort upload of any finals not yet written to the server. */
export async function syncUnsyncedTranscript(
  sessionId: string,
  transcript: Utterance[],
): Promise<number> {
  const pending = transcript.filter((u) => !u.isPartial && !u.syncedToServer && u.text.trim());
  let saved = 0;
  for (const u of pending) {
    const serverId = await persistUtteranceToServer(sessionId, u);
    if (serverId) saved += 1;
  }
  return saved;
}
