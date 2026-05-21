// Owned by Track B3.
// Live transcript Zustand store + IndexedDB persistence for crash recovery.
// Spec §4.1, §5, §7 (browser refresh recovery).
import { create } from "zustand";
import { isBrowser, uuid } from "./utils";

export type Role = "patient" | "staff";
export type Lang = "es" | "en";
export type SessionStatus =
  | "idle"
  | "ready"
  | "listening"
  | "translating"
  | "speaking"
  | "degraded"
  | "offline";

export interface Utterance {
  id: string;
  role: Role;
  langPrimary: Lang;
  text: string;
  translation?: string;
  ts: number;
  isPartial?: boolean;
}

export interface SessionState {
  sessionId: string | null;
  status: SessionStatus;
  statusReason: string | null;
  transcript: Utterance[];

  setSessionId: (id: string | null) => void;
  setStatus: (s: SessionStatus, reason?: string) => void;

  /** Append/replace the current trailing patient partial utterance. */
  addPartial: (text: string) => void;
  /** Promote the trailing partial to a final, optionally with the EN translation. */
  promotePartialToFinal: (es: string, en?: string) => void;
  /** Add a final staff utterance (EN primary, ES translation). */
  addStaffUtterance: (en: string, es: string) => void;
  /** Attach a translation to an existing final patient utterance by id. */
  setTranslation: (utteranceId: string, translation: string) => void;

  reset: () => void;
  /** Hydrate from IndexedDB for crash recovery. No-op server-side. */
  hydrate: (sessionId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// IndexedDB persistence layer (no external dep — `idb-keyval` not installed).
// ---------------------------------------------------------------------------

const IDB_NAME = "clinic-translator";
const IDB_STORE = "session";
const KEY_PREFIX = "clinic-translator-session-";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = window.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

interface PersistedShape {
  sessionId: string;
  transcript: Utterance[];
  savedAt: number;
}

async function idbGet(key: string): Promise<PersistedShape | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as PersistedShape | undefined);
    req.onerror = () => reject(req.error ?? new Error("idb get failed"));
  });
}

async function idbSet(key: string, value: PersistedShape): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb set failed"));
  });
}

/**
 * Best-effort persist. Errors flip status to `degraded` per spec §7
 * ("DB write fail → banner saving paused"). The autosaver swallows
 * the rejection after surfacing it through Zustand state — the model
 * caller never sees an unhandled rejection.
 */
async function persist(state: SessionState): Promise<void> {
  if (!isBrowser() || !state.sessionId) return;
  const payload: PersistedShape = {
    sessionId: state.sessionId,
    // Keep finals only — partials are ephemeral.
    transcript: state.transcript.filter((u) => !u.isPartial),
    savedAt: Date.now(),
  };
  await idbSet(KEY_PREFIX + state.sessionId, payload);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const PARTIAL_ID = "__patient_partial__";

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  status: "idle",
  statusReason: null,
  transcript: [],

  setSessionId: (id) => set({ sessionId: id }),

  setStatus: (status, reason) => set({ status, statusReason: reason ?? null }),

  addPartial: (text) => {
    const transcript = get().transcript.slice();
    const lastIdx = transcript.length - 1;
    const last = lastIdx >= 0 ? transcript[lastIdx] : undefined;
    if (last && last.id === PARTIAL_ID && last.isPartial) {
      transcript[lastIdx] = { ...last, text, ts: Date.now() };
    } else {
      transcript.push({
        id: PARTIAL_ID,
        role: "patient",
        langPrimary: "es",
        text,
        ts: Date.now(),
        isPartial: true,
      });
    }
    set({ transcript });
    // Partials are not persisted.
  },

  promotePartialToFinal: (es, en) => {
    const transcript = get().transcript.slice();
    const lastIdx = transcript.length - 1;
    const last = lastIdx >= 0 ? transcript[lastIdx] : undefined;
    const finalUtt: Utterance = {
      id: uuid(),
      role: "patient",
      langPrimary: "es",
      text: es,
      translation: en,
      ts: Date.now(),
      isPartial: false,
    };
    if (last && last.id === PARTIAL_ID && last.isPartial) {
      transcript[lastIdx] = finalUtt;
    } else {
      transcript.push(finalUtt);
    }
    set({ transcript });
    void persist(get()).catch((err: unknown) => {
      // Don't lose the in-memory utterance; surface via status.
      get().setStatus("degraded", `local save failed: ${stringifyErr(err)}`);
    });
  },

  addStaffUtterance: (en, es) => {
    const transcript = get().transcript.slice();
    transcript.push({
      id: uuid(),
      role: "staff",
      langPrimary: "en",
      text: en,
      translation: es,
      ts: Date.now(),
      isPartial: false,
    });
    set({ transcript });
    void persist(get()).catch((err: unknown) => {
      get().setStatus("degraded", `local save failed: ${stringifyErr(err)}`);
    });
  },

  setTranslation: (utteranceId, translation) => {
    const transcript = get().transcript.map((u) =>
      u.id === utteranceId ? { ...u, translation } : u,
    );
    set({ transcript });
    void persist(get()).catch((err: unknown) => {
      get().setStatus("degraded", `local save failed: ${stringifyErr(err)}`);
    });
  },

  reset: () =>
    set({
      sessionId: null,
      status: "idle",
      statusReason: null,
      transcript: [],
    }),

  hydrate: async (sessionId: string) => {
    if (!isBrowser()) return;
    try {
      const persisted = await idbGet(KEY_PREFIX + sessionId);
      if (persisted) {
        set({
          sessionId: persisted.sessionId,
          transcript: persisted.transcript,
        });
      } else {
        set({ sessionId });
      }
    } catch (err: unknown) {
      get().setStatus("degraded", `hydrate failed: ${stringifyErr(err)}`);
    }
  },
}));

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown error";
}

// Test seam — exposed for unit tests, not part of the public API.
export const __internals = { KEY_PREFIX, PARTIAL_ID };
