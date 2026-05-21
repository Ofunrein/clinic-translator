import * as Sentry from "@sentry/nextjs";

const PHI_KEY_RE = /^(text|translation|name|phone|dob|notes|email)$/i;

/**
 * Recursively delete keys that match PHI_KEY_RE anywhere in the value graph.
 * Mutates `obj` in place. Avoids prototype-polluting `__proto__`/`constructor`.
 */
function scrub(obj: unknown, depth = 0): unknown {
  if (depth > 6 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    for (const v of obj) scrub(v, depth + 1);
    return obj;
  }
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (PHI_KEY_RE.test(key)) {
      record[key] = "[REDACTED]";
      continue;
    }
    scrub(record[key], depth + 1);
  }
  return obj;
}

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.extra) scrub(event.extra);
      if (event.tags) scrub(event.tags);
      if (event.request?.data) scrub(event.request.data);
      if (event.contexts) scrub(event.contexts);
      // Strip query strings — they may contain `?email=…` etc.
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url);
          u.search = "";
          event.request.url = u.toString();
        } catch {
          /* noop */
        }
      }
      return event;
    },
  });
}
