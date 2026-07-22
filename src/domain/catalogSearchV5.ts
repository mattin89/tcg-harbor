export interface CatalogSearchCardV5 {
  name: string;
  number?: string;
  setCode: string;
  variant: string;
}

export function normalizeCatalogQueryV5(query: string): string {
  return query.trim().toLocaleLowerCase('en-US');
}

export function cardMatchesCatalogQueryV5(
  card: CatalogSearchCardV5,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;

  // Set titles can contain a featured character (for example the Katakuri
  // starter deck) even when the individual card is a different character.
  // Search stable card fields here; the dedicated set filter handles titles.
  return [card.name, card.number ?? '', card.setCode, card.variant]
    .join(' ')
    .toLocaleLowerCase('en-US')
    .includes(normalizedQuery);
}

export function selectCardGroupMatchV5<T extends CatalogSearchCardV5>(
  arts: readonly T[],
  normalizedQuery: string,
  setCode: string,
): T | null {
  const eligibleArts = setCode === 'all'
    ? arts
    : arts.filter((art) => art.setCode === setCode);

  if (!normalizedQuery) return eligibleArts[0] ?? null;

  // Return the exact art that matched. Otherwise a grouped DON!! result can
  // be found through its Katakuri art but displayed with a Smoker thumbnail.
  return eligibleArts.find((art) => cardMatchesCatalogQueryV5(art, normalizedQuery)) ?? null;
}
