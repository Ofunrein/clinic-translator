/**
 * Public sign-up policy. The app no longer uses a clinic allowlist: any
 * syntactically valid email address may create an account and use the app.
 * Existing deactivated staff rows are still blocked at the auth callback.
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  const [local, domain, ...rest] = normalized.split("@");
  return Boolean(local && domain && rest.length === 0 && domain.includes("."));
}
