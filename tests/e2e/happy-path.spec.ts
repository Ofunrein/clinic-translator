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

// Dev login: POST to /api/dev-login directly via context.request (shares
// the cookie jar with the browser) so the page carries a valid session.
// Call this BEFORE page.goto so cookies are ready when the page loads.
async function devLogin(page: import("@playwright/test").Page): Promise<void> {
  const ctx = page.context();
  await ctx.request.post("/api/dev-login", {
    form: { email: "ofunrein123@gmail.com" },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "http://localhost:3000/login",
    },
    maxRedirects: 5,
  });
}

test.describe("happy path", () => {
  test("ES transcript + EN translation + send & speak + persist on reload", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["microphone"], {
      origin: "http://localhost:3000",
    });

    // Auth cookie first, before any page navigation.
    await devLogin(page);

    // Mock AudioContext.decodeAudioData so the TTS null-byte stub doesn't cause
    // player.play() to throw (which would prevent addStaff from running).
    await page.addInitScript(() => {
      const OrigAC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!OrigAC) return;
      const origDecode = OrigAC.prototype.decodeAudioData;
      OrigAC.prototype.decodeAudioData = function (
        buffer: ArrayBuffer,
        successCallback?: (buf: AudioBuffer) => void,
      ): Promise<AudioBuffer> {
        // Return a short silent audio buffer instead of trying to decode MP3.
        const silent = this.createBuffer(1, Math.floor(this.sampleRate * 0.05), this.sampleRate);
        successCallback?.(silent);
        return Promise.resolve(silent);
      };
      void origDecode; // silence unused-var lint
    });

    // ---- HTTP stubs (set up before navigation) ----
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

    // Stub /api/stt/token so the SDK gets a fake key (avoids real Deepgram auth).
    await page.route("**/api/stt/token", async (r) => {
      await r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ key: "fake-deepgram-key-for-e2e" }),
      });
    });

    // ---- WebSocket intercept: network-level interception of Deepgram connections ----
    await page.routeWebSocket(/api\.deepgram\.com/, (ws) => {
      ws.onMessage(() => { /* drop binary audio frames */ });

      // Deepgram always sends a Metadata frame on connect. The SDK waits for
      // this (or the WebSocket "open" event) before emitting LiveTranscriptionEvents.Open.
      ws.send(JSON.stringify({ type: "Metadata", transaction_key: "e2e", request_id: "e2e", sha256: "e2e", created: new Date().toISOString(), duration: 0, channels: 1 }));

      // Partial transcript.
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: "Results",
          channel: { alternatives: [{ transcript: "hola", confidence: 0.95 }] },
          is_final: false,
          speech_final: false,
        }));
      }, 300);

      // Final transcript — triggers the UI update we assert on.
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: "Results",
          channel: { alternatives: [{ transcript: "hola, doctor", confidence: 0.99 }] },
          is_final: true,
          speech_final: true,
        }));
      }, 600);
    });

    await page.goto("/app");

    // Start a call.
    await page.getByRole("button", { name: "Start Call" }).click();

    // The WS shim publishes a final ES utterance with EN translation.
    await expect(
      page.locator('[data-testid="patient-transcript"]'),
    ).toContainText("hola, doctor", { timeout: 10000 });
    await expect(
      page.locator('[data-testid="patient-transcript"]'),
    ).toContainText("Hello, doctor");

    // Stub /api/suggest to avoid Groq key errors blocking staff flow.
    await page.route("**/api/suggest", async (r) => {
      await r.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: {"type":"suggestion","suggestion":"Take ibuprofen with food","confidence":0.9,"reasoning":"","escalate":false}\n\ndata: [DONE]\n\n`,
      });
    });
    await page.route("**/api/suggest/outcome", async (r) => {
      await r.fulfill({ status: 200, body: "{}" });
    });

    // Type EN and translate using Ctrl+Enter (works headless on all platforms).
    const ta = page.getByTestId("staff-textarea");
    await ta.click();
    await ta.fill("Take ibuprofen with food");
    await ta.press("Control+Enter");
    const sendBtn = page.getByTestId("send-and-speak");
    await expect(sendBtn).toBeVisible({ timeout: 10000 });

    // Stub utterance persist so it doesn't hit the real DB.
    await page.route(`**/api/sessions/*/utterances`, async (r) => {
      await r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: crypto.randomUUID(), en: "", es: "" }) });
    });

    // Confirm — TTS POST fires and a staff utterance lands in the staff list.
    // Wait for TTS response (not just request) so the play+addStaff chain completes.
    const ttsResponse = page.waitForResponse("**/api/tts");
    await sendBtn.click();
    await ttsResponse;

    await expect(
      page.locator('[data-testid="staff-transcript"]'),
    ).toContainText("Take ibuprofen with food", { timeout: 10000 });

    // ---- Persistence on reload ----
    await page.reload();
    // The URL has `?session=...` so hydrate should fire.
    await expect(
      page.locator('[data-testid="staff-transcript"]'),
    ).toContainText("Take ibuprofen with food", { timeout: 10000 });
    await expect(
      page.locator('[data-testid="patient-transcript"]'),
    ).toContainText("hola, doctor");
  });
});
