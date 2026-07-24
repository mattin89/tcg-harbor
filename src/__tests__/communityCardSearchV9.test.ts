import { describe, expect, it } from 'vitest';
import {
  searchCommunityCardsV9,
  selectAvailableOwnedCommunityCardsV9,
  selectSupportedCommunityCardsV9,
  type CommunityOwnedCardCandidateV9,
} from '../domain/communityCardSearchV9';
import type { CommunityTradePostV6 } from '../domain/communityTradingV6';

function card(
  id: string,
  overrides: Partial<CommunityOwnedCardCandidateV9> = {},
): CommunityOwnedCardCandidateV9 {
  return {
    id,
    kind: 'card',
    name: 'Charlotte Katakuri',
    number: 'OP03-099',
    setCode: 'OP03',
    variant: 'Standard',
    language: 'English',
    quantity: 1,
    collectionItemId: `holding-${id}`,
    ...overrides,
  };
}

function activePost(
  collectionItemId: string,
  quantity = 1,
): CommunityTradePostV6 {
  return {
    id: 'trade-1',
    communityId: 'community-1',
    authorId: 'user-1',
    authorName: 'Mario',
    authorInitials: 'MD',
    postKind: 'offering_card',
    exchangeMode: 'any_card',
    cashAmountCents: null,
    primaryAssetId: 'card-1',
    specificAssetId: null,
    offeredCollectionItemId: collectionItemId,
    offeredQuantity: quantity,
    quantity,
    condition: 'near_mint',
    language: 'English',
    notes: '',
    status: 'open',
    createdAt: '2026-07-24T12:00:00Z',
    own: true,
  };
}

describe('community card search v9', () => {
  it('searches stable card fields without matching unrelated set titles', () => {
    const unrelated = card('opera', {
      name: 'Charlotte Opera',
      number: 'OP03-106',
      setCode: 'ST20',
    });

    expect(searchCommunityCardsV9([unrelated], 'Katakuri').matches).toEqual([]);
  });

  it('keeps regular and alternative arts independently searchable', () => {
    const regular = card('regular');
    const alternate = card('alternate', { variant: 'Alternate art · P2' });

    expect(searchCommunityCardsV9([regular, alternate], 'OP03-099').matches)
      .toEqual([alternate, regular]);
    expect(searchCommunityCardsV9([regular, alternate], 'alternate').matches)
      .toEqual([alternate]);
  });

  it('ranks exact card numbers before looser matches and reports all matches', () => {
    const exact = card('exact', { number: 'OP01-016' });
    const loose = card('loose', {
      name: 'OP01-016 Anniversary DON!!',
      number: 'DON!!',
    });
    const result = searchCommunityCardsV9([loose, exact], 'OP01-016', 1);

    expect(result.matches).toEqual([exact]);
    expect(result.totalMatches).toBe(2);
  });

  it('lets wanted-card search use all non-German card printings', () => {
    const english = card('english');
    const french = card('french', { language: 'French' });
    const german = card('german', { language: 'German' });
    const sealed = card('sealed', { kind: 'sealed' });

    expect(selectSupportedCommunityCardsV9([english, french, german, sealed]))
      .toEqual([english, french]);
  });

  it('allows offers only from owned collection rows with unreserved quantity', () => {
    const available = card('available', { quantity: 2 });
    const fullyReserved = card('reserved');
    const catalogOnly = card('catalog-only', { collectionItemId: undefined });

    expect(selectAvailableOwnedCommunityCardsV9(
      [available, fullyReserved, catalogOnly],
      [
        activePost(available.collectionItemId!, 1),
        activePost(fullyReserved.collectionItemId!, 1),
      ],
    )).toEqual([available]);
  });
});
