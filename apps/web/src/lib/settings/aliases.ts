/**
 * Spec route aliases. The interface spec names `/protect/new`, `/strategies/new`, and `/ops`; the platform builds
 * those surfaces at `/hedges`, `/strategies`, and `/operations`. An alias forwards its whole query so hand-offs such
 * as an exposure prefill survive the hop.
 */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function aliasHref(target: string, searchParams: SearchParamsRecord): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  const text = query.toString();
  return text ? `${target}?${text}` : target;
}
