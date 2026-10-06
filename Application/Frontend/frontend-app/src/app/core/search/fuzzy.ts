/**
 * Forgiving search over instruments: a typed query matches a symbol or a company name even when it is only a
 * prefix, sits in the middle of a word, skips letters ("rlnc" for Reliance) or has a typo ("infsys").
 * Results are ranked so the most likely match comes first.
 */
export interface Searchable {
  symbol: string;
  name: string;
}

export interface Match<T extends Searchable> {
  item: T;
  score: number;
}

const WORD_BREAK = /[^a-z0-9]+/;

/** Lower-case, strip accents, and collapse anything that is not a letter or digit to a single space. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** 0 for no match; higher is better. Exact symbol > symbol prefix > word prefix > substring > subsequence > typo. */
export function scoreText(query: string, target: string): number {
  if (query === '' || target === '') {
    return 0;
  }
  if (target === query) {
    return 100;
  }
  if (target.startsWith(query)) {
    return 90 - Math.min(10, target.length - query.length);
  }
  const words = target.split(WORD_BREAK).filter(Boolean);
  if (words.some((word) => word.startsWith(query))) {
    return 75;
  }
  const at = target.indexOf(query);
  if (at >= 0) {
    return 60 - Math.min(10, at);
  }
  if (query.length >= 3 && isSubsequence(query, target)) {
    return 40 + Math.round(20 * (query.length / target.length));
  }
  if (query.length >= 3) {
    const best = Math.min(
      editDistance(query, target.slice(0, query.length + 1)),
      ...words.map((word) => editDistance(query, word.slice(0, query.length + 1)))
    );
    const allowed = query.length <= 4 ? 1 : 2;
    if (best <= allowed) {
      return 30 - best * 5;
    }
  }
  return 0;
}

/** Best score of the query against the symbol, the name, and each word of the name. The symbol counts for a little more. */
export function scoreInstrument(query: string, item: Searchable): number {
  const q = normalise(query);
  if (q === '') {
    return 0;
  }
  const symbol = scoreText(q, normalise(item.symbol));
  const name = scoreText(q, normalise(item.name));
  return Math.max(symbol * 1.05, name);
}

/**
 * The items that match, best first. An empty query returns everything in its original order. Ties keep their
 * original order, so the list does not shuffle as the quotes refresh.
 */
export function search<T extends Searchable>(query: string, items: readonly T[], limit = Infinity): T[] {
  if (normalise(query) === '') {
    return items.slice(0, limit);
  }
  return items
    .map((item, index): Match<T> & { index: number } => ({ item, score: scoreInstrument(query, item), index }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((match) => match.item);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) {
      at++;
      if (at === needle.length) {
        return true;
      }
    }
  }
  return false;
}

/** Levenshtein distance, with early exit not needed at these lengths. */
export function editDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[b.length];
}
