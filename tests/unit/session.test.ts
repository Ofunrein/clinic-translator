// Owned by Track B3.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { useSessionStore, __internals } from "../../lib/session";

beforeAll(() => {
  // Install a minimal in-memory IndexedDB shim. `fake-indexeddb` isn't a
  // declared dependency, and the project uses jsdom which doesn't ship IDB.
  // This shim mimics just the `open / transaction / get / put` surface that
  // `lib/session.ts` exercises.
  if (typeof window !== "undefined" && !window.indexedDB) {
    installInMemoryIdb();
  }
});

beforeEach(() => {
  useSessionStore.getState().reset();
});

describe("session store", () => {
  it("appends a partial then replaces it on the next addPartial", () => {
    const s = useSessionStore.getState();
    s.addPartial("hola");
    s.addPartial("hola, doctor");
    const t = useSessionStore.getState().transcript;
    expect(t).toHaveLength(1);
    expect(t[0].text).toBe("hola, doctor");
    expect(t[0].isPartial).toBe(true);
    expect(t[0].id).toBe(__internals.PARTIAL_ID);
  });

  it("promotePartialToFinal converts the trailing partial in place", () => {
    const s = useSessionStore.getState();
    s.addPartial("buenos");
    s.promotePartialToFinal("buenos días", "good morning");
    const t = useSessionStore.getState().transcript;
    expect(t).toHaveLength(1);
    expect(t[0].isPartial).toBe(false);
    expect(t[0].text).toBe("buenos días");
    expect(t[0].translation).toBe("good morning");
    expect(t[0].id).not.toBe(__internals.PARTIAL_ID);
  });

  it("promotePartialToFinal appends a new utterance when there's no partial", () => {
    const s = useSessionStore.getState();
    s.promotePartialToFinal("gracias", "thank you");
    const t = useSessionStore.getState().transcript;
    expect(t).toHaveLength(1);
    expect(t[0].text).toBe("gracias");
  });

  it("addStaffUtterance pushes an EN-primary utterance with ES translation", () => {
    const s = useSessionStore.getState();
    s.addStaffUtterance("Take ibuprofen with food", "Tome ibuprofeno con comida");
    const t = useSessionStore.getState().transcript;
    expect(t).toHaveLength(1);
    expect(t[0].role).toBe("staff");
    expect(t[0].langPrimary).toBe("en");
    expect(t[0].text).toBe("Take ibuprofen with food");
    expect(t[0].translation).toBe("Tome ibuprofeno con comida");
  });

  it("setStatus stores the reason", () => {
    const s = useSessionStore.getState();
    s.setStatus("degraded", "stt reconnecting");
    const cur = useSessionStore.getState();
    expect(cur.status).toBe("degraded");
    expect(cur.statusReason).toBe("stt reconnecting");
  });

  it("reset clears transcript, sessionId, and status", () => {
    const s = useSessionStore.getState();
    s.setSessionId("abc");
    s.addStaffUtterance("hi", "hola");
    s.setStatus("listening");
    s.reset();
    const cur = useSessionStore.getState();
    expect(cur.sessionId).toBeNull();
    expect(cur.transcript).toEqual([]);
    expect(cur.status).toBe("idle");
    expect(cur.statusReason).toBeNull();
  });

  it("hydrate restores finals from IndexedDB and sets sessionId", async () => {
    const s = useSessionStore.getState();
    s.setSessionId("call-1");
    s.addStaffUtterance("hello", "hola");
    s.promotePartialToFinal("buenas", "good evening");
    await flushIdb();

    s.reset();
    expect(useSessionStore.getState().transcript).toEqual([]);

    await useSessionStore.getState().hydrate("call-1");
    const restored = useSessionStore.getState();
    expect(restored.sessionId).toBe("call-1");
    expect(restored.transcript.length).toBe(2);
    expect(restored.transcript.find((u) => u.text === "hello")).toBeTruthy();
    expect(restored.transcript.find((u) => u.text === "buenas")).toBeTruthy();
  });

  it("hydrate with no persisted data still sets sessionId", async () => {
    const fresh = `never-saved-${Math.random().toString(16).slice(2)}`;
    await useSessionStore.getState().hydrate(fresh);
    expect(useSessionStore.getState().sessionId).toBe(fresh);
  });

  it("partials are not persisted to IndexedDB", async () => {
    const s = useSessionStore.getState();
    s.setSessionId("call-2");
    s.addPartial("partial only");
    s.promotePartialToFinal("final text", "final text en");
    await flushIdb();

    s.reset();
    await useSessionStore.getState().hydrate("call-2");
    const t = useSessionStore.getState().transcript;
    expect(t.some((u) => u.id === __internals.PARTIAL_ID)).toBe(false);
    expect(t.some((u) => u.text === "final text")).toBe(true);
  });
});

async function flushIdb(): Promise<void> {
  // Two macrotasks: persist() schedules its txn after the state update, then
  // the txn's oncomplete fires on the following microtask.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function installInMemoryIdb(): void {
  type Rec = unknown;
  const store = new Map<string, Rec>();

  const fakeFactory = {
    open(_name: string, _version?: number): IDBOpenDBRequest {
      const req = {
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
        result: undefined as unknown as IDBDatabase,
      };

      const db = {
        objectStoreNames: { contains: () => true } as unknown as DOMStringList,
        createObjectStore() {
          return {} as unknown as IDBObjectStore;
        },
        transaction(_storeName: string, _mode?: IDBTransactionMode) {
          const tx = {
            oncomplete: null as null | (() => void),
            onerror: null as null | (() => void),
            error: null,
            objectStore() {
              return {
                get(key: string) {
                  const r = {
                    onsuccess: null as null | (() => void),
                    onerror: null as null | (() => void),
                    result: store.get(key),
                  };
                  queueMicrotask(() => {
                    r.onsuccess?.();
                  });
                  return r as unknown as IDBRequest;
                },
                put(value: Rec, key: string) {
                  store.set(key, value);
                  queueMicrotask(() => {
                    tx.oncomplete?.();
                  });
                  return {} as unknown as IDBRequest;
                },
              };
            },
          };
          return tx as unknown as IDBTransaction;
        },
      };

      req.result = db as unknown as IDBDatabase;
      queueMicrotask(() => {
        req.onsuccess?.();
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  Object.defineProperty(window, "indexedDB", {
    value: fakeFactory,
    configurable: true,
  });
}
