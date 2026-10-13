import {
  cardMatchesCatalogQueryV5,
  normalizeCatalogQueryV5,
  type CatalogSearchCardV5,
} from './catalogSearchV5';
import {
  availableTradeQuantityV8,
  type CommunityTradePostV6,
} from './communityTradingV6';

export interface CommunityCardSearchCandidateV9 extends CatalogSearchCardV5 {
  readonly id: string;
  readonly language: string;
}

export interface CommunityOwnedCardCandidateV9 extends CommunityCardSearchCandidateV9 {
  readonly kind: 'card' | 'sealed';
  readonly collectionItemId?: string;
  readonly quantity: number;
}

export interface CommunityCardSearchResultsV9<T> {
  readonly matches: readonly T[];
  readonly totalMatches: number;
  readonly normalizedQuery: string;
}

export function communityCardPrintingKey(card: {
  rulesCardId?: string;
  number?: string;
  name: string;
  variant: string;
}): string {
  const cardId = card.rulesCardId ?? card.number;
  if (!cardId || cardId === 'DON!!') {
    return `${card.name}::${card.variant}`;
  }
  return `${cardId}::${card.variant}`;
}

function rankCommunityCardV9(
  card: CommunityCardSearchCandidateV9,
  normalizedQuery: string,
): number {
  if (!normalizedQuery) return 4;
  const name = card.name.toLocaleLowerCase('en-US');
  const number = (card.number ?? '').toLocaleLowerCase('en-US');
  const setCode = card.setCode.toLocaleLowerCase('en-US');
  const variant = card.variant.toLocaleLowerCase('en-US');

  if (name === normalizedQuery || number === normalizedQuery) return 0;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const cleanNumber = number.replace(/[-_.]/g, '');
    const cleanSetCode = setCode.replace(/[-_.]/g, '');
    const hasExactNumber = tokens.some((t) => t === number || t.replace(/[-_.]/g, '') === cleanNumber);
    const hasSetMatch = tokens.some((t) => t === setCode || t.replace(/[-_.]/g, '') === cleanSetCode);
    const hasNameMatch = tokens.some((t) => name.includes(t));
    if (hasExactNumber && hasNameMatch) return 0;
    if (hasExactNumber || (hasSetMatch && hasNameMatch)) return 1;
  }

  if (name.startsWith(normalizedQuery)) return 1;
  if (number.startsWith(normalizedQuery) || setCode === normalizedQuery) return 2;
  if (variant.startsWith(normalizedQuery)) return 3;
  return 4;
}

export function searchCommunityCardsV9<T extends CommunityCardSearchCandidateV9>(
  cards: readonly T[],
  query: string,
  limit = 40,
): CommunityCardSearchResultsV9<T> {
  const normalizedQuery = normalizeCatalogQueryV5(query);
  const matching = cards.filter((card) => cardMatchesCatalogQueryV5(card, normalizedQuery));

  // Group matching cards by printing so different languages of the same card printing
  // appear as one listing in the search results.
  const groups = new Map<string, T[]>();
  for (const card of matching) {
    const key = communityCardPrintingKey(card);
    const existing = groups.get(key);
    if (existing) {
      existing.push(card);
    } else {
      groups.set(key, [card]);
    }
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const representatives: T[] = [];

  for (const groupCards of groups.values()) {
    // If a card's language was specifically mentioned in query tokens, prefer that language
    const languageMatched = groupCards.find((card) =>
      queryTokens.some((token) => card.language.toLocaleLowerCase('en-US') === token)
    );
    if (languageMatched) {
      representatives.push(languageMatched);
      continue;
    }
    // Otherwise prefer English as base representative
    const englishCard = groupCards.find(
      (card) => card.language.toLocaleLowerCase('en-US') === 'english'
    );
    representatives.push(englishCard ?? groupCards[0]);
  }

  const sorted = representatives.sort((left, right) => (
    rankCommunityCardV9(left, normalizedQuery) - rankCommunityCardV9(right, normalizedQuery)
    || left.name.localeCompare(right.name, 'en-US')
    || (left.number ?? '').localeCompare(right.number ?? '', 'en-US', { numeric: true })
    || left.setCode.localeCompare(right.setCode, 'en-US', { numeric: true })
    || left.variant.localeCompare(right.variant, 'en-US')
    || left.language.localeCompare(right.language, 'en-US')
    || left.id.localeCompare(right.id)
  ));

  return {
    matches: sorted.slice(0, Math.max(1, limit)),
    totalMatches: sorted.length,
    normalizedQuery,
  };
}

export function selectSupportedCommunityCardsV9<T extends CommunityOwnedCardCandidateV9>(
  cards: readonly T[],
): T[] {
  return cards.filter((card) => (
    card.kind === 'card'
    && card.language.toLocaleLowerCase('en-US') !== 'german'
  ));
}

export function selectAvailableOwnedCommunityCardsV9<T extends CommunityOwnedCardCandidateV9>(
  cards: readonly T[],
  posts: readonly CommunityTradePostV6[],
): T[] {
  return selectSupportedCommunityCardsV9(cards).filter((card) => (
    Boolean(card.collectionItemId)
    && availableTradeQuantityV8(card.quantity, card.collectionItemId, posts) > 0
  ));
}
