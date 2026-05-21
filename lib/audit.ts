import { db } from "./db/client";
import { auditLog } from "./db/schema";

export type AuditAction =
  | "view"
  | "edit"
  | "create"
  | "delete"
  | "auth_login"
  | "auth_logout"
  | "translate_refused"
  | "decrypt_failed";

export type AuditTargetType =
  | "patient"
  | "call"
  | "utterance"
  | "staff_user"
  | "glossary_term";

export interface RecordAuditArgs {
  actorId: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  ipAddr?: string | null;
  reason?: string | null;
}

// Sentry import is best-effort; not all runtimes (test, edge) load it.
type SentryLike = { captureException: (e: unknown, ctx?: unknown) => void };
let sentry: SentryLike | null = null;
try {
  // Avoid bundling failures if @sentry/nextjs isn't present at build time.
  // eslint-disable-next-line
  const mod = require("@sentry/nextjs") as Partial<SentryLike>;
  if (mod && typeof mod.captureException === "function") {
    sentry = mod as SentryLike;
  }
} catch {
  sentry = null;
}

/**
 * Insert an audit_log row. Never throws — audit failures must not break the app.
 * On DB failure: forward to Sentry (PHI-free) or fall back to console.error.
 */
export async function recordAudit(args: RecordAuditArgs): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: args.actorId ?? null,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId ?? null,
      ipAddr: args.ipAddr ?? null,
      reason: args.reason ?? null,
    });
  } catch (err) {
    const safePayload = {
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      actorId: args.actorId,
      // intentionally omit ipAddr/reason from console paths to be conservative
    };
    if (sentry) {
      sentry.captureException(err, { extra: { audit: safePayload } });
    } else {
      console.error("[audit] write failed", safePayload, err);
    }
  }
}

// ---- withAudit route wrapper ----

export type RouteHandler<TReq, TRes> = (req: TReq) => Promise<TRes> | TRes;

export interface WithAuditOptions {
  targetType: AuditTargetType;
  /** Resolve the acting user id (e.g. from session). */
  resolveActor: (req: Request) => Promise<string | null> | string | null;
  /** Resolve the target row id from the request (path param, body, etc). */
  resolveTargetId?: (req: Request) => Promise<string | null> | string | null;
  /** Resolve client IP (e.g. from x-forwarded-for). */
  resolveIp?: (req: Request) => string | null;
}

/**
 * Wrap a Next.js route handler so that GET/HEAD = "view" and write methods
 * = "edit" get logged automatically against patient / call / utterance rows.
 * Audit runs after the handler resolves so we don't block the response,
 * and never throws to the caller.
 */
export function withAudit<TRes>(
  handler: RouteHandler<Request, TRes>,
  opts: WithAuditOptions,
): RouteHandler<Request, TRes> {
  return async (req: Request): Promise<TRes> => {
    const result = await handler(req);
    const method = req.method.toUpperCase();
    const action: AuditAction =
      method === "GET" || method === "HEAD" ? "view" : "edit";
    try {
      const actorId = await opts.resolveActor(req);
      const targetId = opts.resolveTargetId ? await opts.resolveTargetId(req) : null;
      const ipAddr = opts.resolveIp ? opts.resolveIp(req) : null;
      // fire-and-forget; recordAudit swallows its own errors
      void recordAudit({
        actorId,
        action,
        targetType: opts.targetType,
        targetId,
        ipAddr,
      });
    } catch (err) {
      if (sentry) {
        sentry.captureException(err, { extra: { audit: "withAudit-resolver-failed" } });
      } else {
        console.error("[audit] resolver failed", err);
      }
    }
    return result;
  };
}
