// Owned by Track B3. Spec §9 (Phase 1 happy path).
//
// Strategy: drive the UI as a real user but stub the backend at the
// network boundary via Playwright's `route` so this can run before
// Track B2 ships. We:
//   1. Stub `/api/sessions` POST → returns a fake session.
//   2. Stub `/api/stt` WS by replacing the WebSocket constructor in the
//      page context and feeding fake partial/final frames.
//   3. Stub `/api/translate` POST → returns the fake ES preview / EN xlation.
//   4. Stub `/api/tts` POST → returns a tiny silent MP3.
//   5. Assert reload preserves the staff utterance via IndexedDB.
import { test, expect } from "@playwright/test";

const FAKE_SESSION_ID = "e2e-session-0001";

test.describe("happy path", () => {
  test("ES transcript + EN translation + send & speak + persist on reload", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["microphone"], {
      origin: "http://localhost:3000",
    });

    // ---- HTTP stubs ----
    await page.route("**/api/sessions", async (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      await r.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: FAKE_SESSION_ID,
          startedAt: new Date().toISOString(),
          urgency: "routine",
        }),
      });
    });
    await page.route(`**/api/sessions/${FAKE_SESSION_ID}`, async (r) => {
      if (r.request().method() === "GET") {
        await r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: FAKE_SESSION_ID,
            startedAt: new Date().toISOString(),
            urgency: "routine",
          }),
        });
      } else {
        await r.fulfill({ status: 200, body: "{}" });
      }
    });
    await page.route("**/api/translate", async (r) => {
      const body = JSON.parse(r.request().postData() ?? "{}") as {
        src: string;
        text: string;
      };
      // EN→ES
      if (body.src === "en") {
        await r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            translation: "Tome ibuprofeno con comida",
            glossary_hits: [],
            trace_id: "t-1",
          }),
        });
      } else {
        await r.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            translation: "Hello, doctor.",
            glossary_hits: [],
          }),
        });
      }
    });
    // Smallest-valid MPEG frame for autoplay test.
    await page.route("**/api/tts", async (r) => {
      // ~1KB silent MP3 frame placeholder. Browsers tolerate decoding errors;
      // we assert the network call, not the audio output.
      const buf = Buffer.alloc(1024);
      await r.fulfill({
        status: 200,
        contentType: "audio/mpeg",
        body: buf,
      });
    });

    // ---- WS stub: shim WebSocket before app code runs ----
    await page.addInitScript(() => {
      const Real = window.WebSocket;
      class FakeWs extends EventTarget {
        readyState = 0;
        binaryType: BinaryType = "blob";
        onopen: ((ev: Event) => void) | null = null;
        onmessage: ((ev: MessageEvent) => void) | null = null;
        onclose: ((ev: CloseEvent) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        url: string;
        constructor(url: string) {
          super();
          this.url = url;
          // Open shortly so the app sees a connected socket.
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.(new Event("open"));
          }, 50);
          // Push a partial then a final ES utterance.
          setTimeout(() => {
            this.onmessage?.(
              new MessageEvent("message", {
                data: JSON.stringify({ type: "partial", text: "hola" }),
              }) as MessageEvent,
            );
          }, 200);
          setTimeout(() => {
            this.onmessage?.(
              new MessageEvent("message", {
                data: JSON.stringify({
                  type: "final",
                  text: "hola, doctor",
                  translation: "hello, doctor",
                }),
              }) as MessageEvent,
            );
          }, 400);
        }
        send(_data: unknown): void { /* drop */ }
        close(): void {
          this.readyState = 3;
          this.onclose?.(new CloseEvent("close"));
        }
      }
      // Cast through unknown — Playwright's tsconfig is permissive enough.
      (window as unknown as { WebSocket: unknown }).WebSocket = FakeWs as unknown;
      // Keep a reference so debugging is easy.
      (window as unknown as { __RealWs: typeof Real }).__RealWs = Real;
    });

    await page.goto("/");

    // Start a call.
    await page.getByRole("button", { name: "Start Call" }).click();

    // The WS shim publishes a final ES utterance with EN translation.
    await expect(
      page.locator('[data-testid="patient-transcript"]'),
    ).toContainText("hola, doctor", { timeout: 5000 });
    await expect(
      page.locator('[data-testid="patient-transcript"]'),
    ).toContainText("hello, doctor");

    // Type EN, hit Cmd+Enter, get preview.
    const ta = page.getByTestId("staff-textarea");
    await ta.fill("Take ibuprofen with food");
    // Use the OS-appropriate chord — Playwright maps `Meta` to ⌘ on macOS,
    // `Control` on others. We always send both via keyboard shortcuts API.
    await ta.press("Meta+Enter");
    // Fall back to Ctrl+Enter if Meta+Enter didn't trigger (non-mac runner).
    const sendBtn = page.getByTestId("send-and-speak");
    if (!(await sendBtn.isVisible().catch(() => false))) {
      await ta.press("Control+Enter");
    }
    await expect(sendBtn).toBeVisible({ timeout: 4000 });

    // Confirm — TTS POST fires and a staff utterance lands in the staff list.
    const ttsRequest = page.waitForRequest("**/api/tts");
    await sendBtn.click();
    await ttsRequest;

    await expect(
      page.locator('[data-testid="staff-transcript"]'),
    ).toContainText("Take ibuprofen with food", { timeout: 4000 });

    // ---- Persistence on reload ----
    await page.reload();
    // The URL has `?session=...` so hydrate should fire.
    await expect(
      page.locator('[data-testid="staff-transcript"]'),
    ).toContainText("Take ibuprofen with food", { timeout: 4000 });
    await expect(
      page.locator('[data-testid="patient-transcript"]'),
    ).toContainText("hola, doctor");
  });
});
