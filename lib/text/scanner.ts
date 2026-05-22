// Shared text-scanning primitives used by medical-glossary and urgency-keywords.

/**
 * Lowercase + strip Unicode combining diacritics (NFD decomposition,
 * remove U+0300–U+036F). Matches the strip logic in urgency-keywords.ts.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Build a diacritic-stripped projection of `text` while preserving a map
 * from each stripped-string index back to the original character index.
 * Used for offset-preserving scans (urgency-keywords path).
 */
export function buildNormalizedProjection(text: string): {
  haystack: string;
  offsetMap: number[];
} {
  const stripped: string[] = [];
  const offsetMap: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toLowerCase();
    const decomp = ch.normalize("NFD");
    for (const c of decomp) {
      const code = c.charCodeAt(0);
      if (code >= 0x0300 && code <= 0x036f) continue;
      stripped.push(c);
      offsetMap.push(i);
    }
  }
  return { haystack: stripped.join(""), offsetMap };
}

export interface ScanMatch<T> {
  item: T;
  needle: string;
  start: number;
  end: number;
  matched: string;
}

/**
 * Substring scan of every `needle` string produced by `getNeedles(item)`
 * against the lowercased `text`. Returns every (possibly overlapping)
 * match with original-text offsets.
 *
 * Used by the glossary scanner which operates on simple lowercase-only
 * matching (no diacritic stripping) to preserve its existing behaviour.
 */
export function scanSubstrings<T>(
  text: string,
  items: readonly T[],
  getNeedles: (item: T) => string[],
): ScanMatch<T>[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const hits: ScanMatch<T>[] = [];

  for (const item of items) {
    for (const raw of getNeedles(item)) {
      const needle = raw.toLowerCase();
      if (!needle) continue;
      let from = 0;
      while (from <= lower.length - needle.length) {
        const idx = lower.indexOf(needle, from);
        if (idx === -1) break;
        const end = idx + needle.length;
        hits.push({ item, needle, start: idx, end, matched: text.slice(idx, end) });
        from = end;
      }
    }
  }

  return hits;
}

/**
 * Offset-preserving scan using the diacritic-stripped projection from
 * `buildNormalizedProjection`. Needles are normalized via `normalize()`.
 * Used by the urgency-keywords scanner.
 */
export function scanNormalized<T>(
  text: string,
  items: readonly T[],
  getNeedles: (item: T) => string[],
): ScanMatch<T>[] {
  if (!text) return [];
  const { haystack, offsetMap } = buildNormalizedProjection(text);
  const hits: ScanMatch<T>[] = [];

  for (const item of items) {
    for (const raw of getNeedles(item)) {
      const needle = normalize(raw);
      if (!needle) continue;
      let from = 0;
      while (from < haystack.length) {
        const idx = haystack.indexOf(needle, from);
        if (idx < 0) break;
        const startOrig = offsetMap[idx] ?? idx;
        const endOrigInclusive = offsetMap[idx + needle.length - 1] ?? idx + needle.length - 1;
        hits.push({
          item,
          needle,
          start: startOrig,
          end: endOrigInclusive + 1,
          matched: text.slice(startOrig, endOrigInclusive + 1),
        });
        from = idx + needle.length;
      }
    }
  }

  return hits;
}
