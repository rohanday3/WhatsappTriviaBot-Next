/**
 * Edit distance with adjacent-transposition support (optimal string alignment),
 * so a common typo like swapping two letters ("sprots" -> "sports") costs 1
 * instead of 2, matching how people actually mistype words.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

export interface FuzzyMatch<T> {
  item: T;
  text: string;
  distance: number;
}

/**
 * Ranks candidates against a query, treating prefix/substring hits as
 * effectively free so a short fragment (e.g. "vid") still surfaces
 * "videogames" ahead of an unrelated word at the same edit distance.
 * Results are filtered to a threshold that scales with query length and
 * sorted closest-first.
 */
export function rankFuzzyMatches<T>(
  query: string,
  candidates: Array<{ item: T; text: string }>,
  maxDistance = 2,
): FuzzyMatch<T>[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const threshold = Math.max(maxDistance, Math.ceil(normalizedQuery.length * 0.4));
  const scored = candidates.map(({ item, text }): FuzzyMatch<T> => {
    const normalizedText = text.trim().toLowerCase();
    let distance: number;
    if (normalizedText === normalizedQuery) distance = 0;
    else if (normalizedText.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedText)) distance = 0.5;
    else if (normalizedText.includes(normalizedQuery)) distance = 1;
    else distance = levenshteinDistance(normalizedQuery, normalizedText);
    return { item, text, distance };
  });
  return scored.filter((entry) => entry.distance <= threshold).sort((a, b) => a.distance - b.distance);
}
