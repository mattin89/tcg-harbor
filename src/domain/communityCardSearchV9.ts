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

function rankCommunityCardV9(
  card: CommunityCardSearchCandidateV9,
  normalizedQuery: string,
): number {
  if (!normalizedQuery) return 4;
  const name = card.name.toLocaleLowerCase('en-US');
  const number = card.number?.toLocaleLowerCase('en-US') ?? '';
  const setCode = card.setCode.toLocaleLowerCase('en-US');
  const variant = card.variant.toLocaleLowerCase('en-US');

  if (name === normalizedQuery || number === normalizedQuery) return 0;
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
  const matching = cards
    .filter((card) => cardMatchesCatalogQueryV5(card, normalizedQuery))
    .sort((left, right) => (
      rankCommunityCardV9(left, normalizedQuery) - rankCommunityCardV9(right, normalizedQuery)
      || left.name.localeCompare(right.name, 'en-US')
      || (left.number ?? '').localeCompare(right.number ?? '', 'en-US', { numeric: true })
      || left.setCode.localeCompare(right.setCode, 'en-US', { numeric: true })
      || left.variant.localeCompare(right.variant, 'en-US')
      || left.language.localeCompare(right.language, 'en-US')
      || left.id.localeCompare(right.id)
    ));

  return {
    matches: matching.slice(0, Math.max(1, limit)),
    totalMatches: matching.length,
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
