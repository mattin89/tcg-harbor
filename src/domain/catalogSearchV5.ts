export interface CatalogSearchCardV5 {
  name: string;
  productName?: string;
  number?: string;
  rulesCardId?: string;
  id?: string;
  setCode: string;
  variant: string;
}

export function isDonCardV5(card: { rulesCardId?: string; number?: string }): boolean {
  return card.rulesCardId === 'DON!!' || card.number === 'DON!!';
}

export function normalizeBaseSetCode(setCode: string): string {
  const clean = setCode.replace(/[-_](CN|FR|JP|KR|DE|ES|IT|EN)$/i, '');
  if (clean === 'PROMO') return 'P';
  return clean;
}

export function isTournamentPromoCard(card: {
  setCode?: string;
  set?: string;
  name?: string;
  variant?: string;
  productName?: string;
  cardmarketExpansionId?: number;
}): boolean {
  if (card.setCode === 'STP' || card.set === 'Special Tournaments Promos') return true;
  if (card.cardmarketExpansionId === 5262) return true;
  const str = `${card.name ?? ''} ${card.variant ?? ''} ${card.set ?? ''} ${card.productName ?? ''}`.toLocaleLowerCase('en-US');
  return (
    str.includes('tournament') ||
    str.includes('championship') ||
    str.includes('regional') ||
    str.includes('treasure cup') ||
    str.includes('winner pack') ||
    str.includes('judge pack') ||
    str.includes('finalist') ||
    str.includes('coliseum champion') ||
    str.includes('trophy')
  );
}

export function isPromotionCard(card: {
  setCode?: string;
  set?: string;
  number?: string;
  rulesCardId?: string;
}): boolean {
  if (card.setCode === 'P' || card.setCode === 'PROMO') return true;
  if (card.number && /^P-\d+/i.test(card.number)) return true;
  if (card.rulesCardId && /^P-\d+/i.test(card.rulesCardId)) return true;
  if (card.set && /promotion/i.test(card.set)) return true;
  return false;
}

export function catalogCardGroupIdV5(card: { id: string; rulesCardId?: string; number?: string }): string {
  if (isDonCardV5(card)) {
    return card.id;
  }
  return card.rulesCardId ?? card.number ?? card.id;
}

export function normalizeCatalogQueryV5(query: string): string {
  return query.trim().toLocaleLowerCase('en-US');
}

export function cardMatchesCatalogQueryV5(
  card: CatalogSearchCardV5,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  // Set titles can contain a featured character (for example the Katakuri
  // starter deck) even when the individual card is a different character.
  // Search stable card fields here; the dedicated set filter handles titles.
  const rawFields = [
    card.name,
    card.productName ?? '',
    card.number ?? '',
    card.setCode,
    card.variant,
    (card as { language?: string }).language ?? '',
  ];

  const lowerFields = rawFields.map((f) => f.toLocaleLowerCase('en-US'));
  const haystack = lowerFields.join(' ');
  const nameSpaced = card.name.toLocaleLowerCase('en-US').replace(/[.]/g, ' ');
  const setCodeClean = card.setCode.toLocaleLowerCase('en-US').replace(/[-_]/g, '');
  const numberClean = (card.number ?? '').toLocaleLowerCase('en-US').replace(/[-_]/g, '');
  const fullHaystack = `${haystack} ${nameSpaced} ${setCodeClean}`;

  return tokens.every((token) => {
    if (fullHaystack.includes(token)) return true;
    const cleanToken = token.replace(/[-_]/g, '');
    if (cleanToken && numberClean && numberClean === cleanToken) return true;
    return false;
  });
}

export function selectCardGroupMatchV5<T extends CatalogSearchCardV5>(
  arts: readonly T[],
  normalizedQuery: string,
  setCode: string,
): T | null {
  const eligibleArts = setCode === 'all'
    ? arts
    : arts.filter((art) => {
        if (setCode === 'STP') {
          return isTournamentPromoCard(art as Parameters<typeof isTournamentPromoCard>[0]);
        }
        if (setCode === 'P') {
          return isPromotionCard(art as Parameters<typeof isPromotionCard>[0]);
        }
        return (
          art.setCode === setCode ||
          art.setCode.startsWith(`${setCode}-`) ||
          normalizeBaseSetCode(art.setCode) === setCode
        );
      });

  if (!normalizedQuery) return eligibleArts[0] ?? null;

  // Return the exact art that matched. Otherwise a grouped DON!! result can
  // be found through its Katakuri art but displayed with a Smoker thumbnail.
  return eligibleArts.find((art) => cardMatchesCatalogQueryV5(art, normalizedQuery)) ?? null;
}
