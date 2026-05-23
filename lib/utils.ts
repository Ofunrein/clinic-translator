// Owned by Track B3.
// Shared client/server utilities. No PHI logging — see ESLint `no-phi-log`.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a unix-ms timestamp as `HH:MM:SS` in the local zone. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 32-bit FNV-1a hash. Stable, non-cryptographic. Used for TTS cache keys
 * and React `key`s on synthetic items. NOT for security or PHI minimization.
 */
export function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** UUID v4. Uses `crypto.randomUUID` when available, falls back to Math.random for old jsdom. */
export function uuid(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** True when running in a browser-ish environment that exposes `window` + `indexedDB`. */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

/** Detect macOS so UI can prefer ⌘ in labels. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  if (platform) return platform.toLowerCase().includes("mac");
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent || "");
}

/** Translate / send chord — works on Mac (⌘) and Windows/Linux (Ctrl). */
export function isSubmitChord(ev: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">): boolean {
  return ev.key === "Enter" && (ev.metaKey || ev.ctrlKey);
}

/** Keyboard hint shown next to staff compose actions. */
export function submitChordLabel(): string {
  return isMac() ? "⌘+Enter / Ctrl+Enter" : "Ctrl+Enter / ⌘+Enter";
}
