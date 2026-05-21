/**
 * Next.js instrumentation hook. Loads the runtime-appropriate Sentry config.
 * Sentry is disabled (no init) when SENTRY_DSN is unset.
 */
export async function register(): Promise<void> {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
