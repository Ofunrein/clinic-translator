/**
 * Email allowlist driven by `CLINIC_EMAIL_ALLOWLIST` (comma-separated).
 *
 * Entries can be either:
 *   - exact addresses: `alice@clinic.com`
 *   - wildcard patterns: `*@clinic.com` (matches any local-part for the domain)
 *
 * Matching is case-insensitive. An empty/unset allowlist denies everyone;
 * fail-closed is required for HIPAA (§8).
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return false;

  const raw = process.env.CLINIC_EMAIL_ALLOWLIST ?? "";
  const entries = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0) return false;

  for (const entry of entries) {
    if (entry === normalized) return true;
    if (entry.startsWith("*@")) {
      const domain = entry.slice(2);
      const at = normalized.indexOf("@");
      if (at >= 0 && normalized.slice(at + 1) === domain) return true;
    }
  }
  return false;
}
