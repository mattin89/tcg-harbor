import { describe, expect, it } from 'vitest';
import {
  addCollectionItem,
  authorizeDirectConversation,
  calculatePortfolioPerformance,
  canReadDirectConversation,
  closestSnapshotAtOrBefore,
  communityMessagesForViewer,
  createDirectConversation,
  createTradePost,
  directMessagesForViewer,
  joinCommunityWithCode,
  parseTradePostDraft,
  privateCollectionForViewer,
  toPublicTradeHoldingDisclosure,
  validateStoreJoin,
} from '../domain';
import type {
  CollectionAddInput,
  CollectionItem,
  CommunityMembership,
  CommunityMessage,
  DirectMessage,
  PortfolioHolding,
  PriceSnapshot,
  StoreJoinCode,
} from '../domain';

const NOW = '2026-06-30T12:00:00.000Z';
const LATER = '2026-07-02T09:15:00.000Z';
const CARD_ITEM_ID = 'collection-card-1';
const CATALOG_ID = 'variant-op01-001-aa';

const holding: PortfolioHolding = {
  collectionItemId: CARD_ITEM_ID,
  catalogItemId: CATALOG_ID,
  assetType: 'card',
  currentQuantity: 2,
  createdAt: '2026-05-01T12:00:00.000Z',
  quantityEvents: [
    {
      id: 'quantity-initial',
      collectionItemId: CARD_ITEM_ID,
      delta: 2,
      quantityAfter: 2,
      occurredAt: '2026-05-01T12:00:00.000Z',
      reason: 'added',
    },
  ],
};

function snapshot(
  id: string,
  provider: 'cardmarket' | 'tcgplayer',
  currency: 'EUR' | 'USD',
  unitMarketValue: number,
  capturedAt: string,
  catalogItemId = CATALOG_ID,
): PriceSnapshot {
  return { id, catalogItemId, provider, currency, unitMarketValue, capturedAt };
}

const priceHistory: readonly PriceSnapshot[] = [
  snapshot('cm-month', 'cardmarket', 'EUR', 5, '2026-05-31T11:59:00.000Z'),
  snapshot('cm-week', 'cardmarket', 'EUR', 8, '2026-06-23T11:59:00.000Z'),
  snapshot('cm-day', 'cardmarket', 'EUR', 10, '2026-06-29T11:59:00.000Z'),
  snapshot('cm-after-day-boundary', 'cardmarket', 'EUR', 99, '2026-06-29T12:00:01.000Z'),
  snapshot('cm-current', 'cardmarket', 'EUR', 12, NOW),
  snapshot('tcg-month', 'tcgplayer', 'USD', 7, '2026-05-31T11:59:00.000Z'),
  snapshot('tcg-week', 'tcgplayer', 'USD', 9, '2026-06-23T11:59:00.000Z'),
  snapshot('tcg-day', 'tcgplayer', 'USD', 11, '2026-06-29T11:59:00.000Z'),
  snapshot('tcg-current', 'tcgplayer', 'USD', 15, NOW),
];

function performance(
  period: '1D' | '1W' | '1M',
  provider: 'cardmarket' | 'tcgplayer' = 'cardmarket',
) {
  return calculatePortfolioPerformance({
    holdings: [holding],
    snapshots: priceHistory,
    provider,
    currency: provider === 'cardmarket' ? 'EUR' : 'USD',
    period,
    asOf: NOW,
  });
}

const cardInput = {
  assetType: 'card' as const,
  ownerId: 'mario',
  cardVariantId: CATALOG_ID,
  condition: 'near_mint' as const,
  language: 'EN' as const,
  quantity: 1,
  purchasePricePerUnit: { amount: 8, currency: 'EUR' as const },
  privateNote: 'Private acquisition note',
};

function member(
  id: string,
  userId: string,
  communityId = 'community-berlin',
  status: CommunityMembership['status'] = 'active',
): CommunityMembership {
  return {
    id,
    userId,
    communityId,
    status,
    role: 'member',
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const joinCode: StoreJoinCode = {
  id: 'code-1',
  publicCode: 'BERLIN-HARBOR',
  storeId: 'store-berlin',
  communityId: 'community-berlin',
  active: true,
  useCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
};

const tradeDraft = {
  communityId: 'community-berlin',
  offeredItems: [
    { catalogItemId: CATALOG_ID, quantity: 1, condition: 'near_mint', language: 'EN' },
  ],
  wantedItems: [
    { catalogItemId: 'variant-op05-060', desiredCondition: 'near_mint', desiredLanguage: 'EN' },
  ],
  notes: 'Meet at the store during league night.',
};

describe('TCG Harbor core business rules', () => {
  it('1. calculates current portfolio value as unit value times quantity', () => {
    const result = performance('1D');
    expect(result.currentValue).toBe(24);
    expect(result.knownCurrentValue).toBe(24);
    expect(result.currency).toBe('EUR');
  });

  it('2. calculates 1D, 1W, and 1M changes from the closest snapshot at or before each boundary', () => {
    expect(performance('1D')).toMatchObject({ startingValue: 20, absoluteChange: 4, percentageChange: 20 });
    expect(performance('1W')).toMatchObject({ startingValue: 16, absoluteChange: 8, percentageChange: 50 });
    expect(performance('1M')).toMatchObject({ startingValue: 10, absoluteChange: 14, percentageChange: 140 });
    expect(
      closestSnapshotAtOrBefore(
        priceHistory,
        CATALOG_ID,
        'cardmarket',
        'EUR',
        '2026-06-29T12:00:00.000Z',
      )?.id,
    ).toBe('cm-day');
  });

  it('3. reports missing historical snapshots as insufficient instead of zero', () => {
    const result = calculatePortfolioPerformance({
      holdings: [holding],
      snapshots: [snapshot('only-current', 'cardmarket', 'EUR', 12, NOW)],
      provider: 'cardmarket',
      currency: 'EUR',
      period: '1D',
      asOf: NOW,
    });
    expect(result.currentValue).toBe(24);
    expect(result.startingValue).toBeNull();
    expect(result.absoluteChange).toBeNull();
    expect(result.insufficientHistoryItemIds).toEqual([CARD_ITEM_ID]);
  });

  it('4. values quantity events separately so added inventory is not reported as pure appreciation', () => {
    const changedHolding: PortfolioHolding = {
      ...holding,
      currentQuantity: 2,
      quantityEvents: [
        { ...holding.quantityEvents[0], delta: 1, quantityAfter: 1 },
        {
          id: 'quantity-added-during-period',
          collectionItemId: CARD_ITEM_ID,
          delta: 1,
          quantityAfter: 2,
          occurredAt: '2026-06-29T18:00:00.000Z',
          reason: 'increased',
        },
      ],
    };
    const result = calculatePortfolioPerformance({
      holdings: [changedHolding],
      snapshots: [
        snapshot('start', 'cardmarket', 'EUR', 10, '2026-06-29T11:59:00.000Z'),
        snapshot('at-add', 'cardmarket', 'EUR', 11, '2026-06-29T17:59:00.000Z'),
        snapshot('current', 'cardmarket', 'EUR', 12, NOW),
      ],
      provider: 'cardmarket',
      currency: 'EUR',
      period: '1D',
      asOf: NOW,
    });
    expect(result).toMatchObject({
      startingValue: 10,
      currentValue: 24,
      absoluteChange: 14,
      inventoryFlowValue: 11,
      pricePerformanceChange: 3,
      pricePerformancePercentage: 30,
    });
  });

  it('5. switches cleanly between native Cardmarket/EUR and TCGPlayer/USD histories', () => {
    expect(performance('1D', 'cardmarket')).toMatchObject({ currentValue: 24, currency: 'EUR' });
    expect(performance('1D', 'tcgplayer')).toMatchObject({ currentValue: 30, currency: 'USD' });
  });

  it('6. adds an individual card with private acquisition metadata', () => {
    const result = addCollectionItem([], cardInput, {
      newItemId: 'new-card',
      newAcquisitionLotId: 'lot-new-card',
      now: NOW,
      marketReferencesAtAdd: [
        { provider: 'cardmarket', currency: 'EUR', value: 12 },
        { provider: 'tcgplayer', currency: 'USD', value: null },
      ],
    });
    expect(result.status).toBe('added');
    if (result.status !== 'added') throw new Error('Expected a newly added card.');
    expect(result.item).toMatchObject({
      assetType: 'card',
      cardVariantId: CATALOG_ID,
      quantity: 1,
      privateNote: 'Private acquisition note',
      acquiredAt: '2026-06-30',
      acquisitionLots: [{
        id: 'lot-new-card',
        collectionItemId: 'new-card',
        addedAt: NOW,
        quantity: 1,
        marketReferences: [
          {
            catalogItemId: CATALOG_ID,
            provider: 'cardmarket',
            currency: 'EUR',
            value: 12,
            capturedAt: NOW,
          },
          {
            catalogItemId: CATALOG_ID,
            provider: 'tcgplayer',
            currency: 'USD',
            value: null,
            capturedAt: NOW,
          },
        ],
      }],
    });
    expect(Object.isFrozen(result.item.acquisitionLots)).toBe(true);
    expect(Object.isFrozen(result.item.acquisitionLots[0])).toBe(true);
    expect(Object.isFrozen(result.item.acquisitionLots[0].marketReferences)).toBe(true);
    expect(Object.isFrozen(result.item.acquisitionLots[0].marketReferences[0])).toBe(true);

    const inputWithUserDate: CollectionAddInput = {
      ...cardInput,
      // @ts-expect-error Acquisition dates are generated from trusted operation time.
      acquiredAt: '1999-01-01',
    };
    expect(() => addCollectionItem([], inputWithUserDate, {
      newItemId: 'date-injection',
      newAcquisitionLotId: 'lot-date-injection',
      now: NOW,
    })).toThrow(/acquiredAt is automatic/i);
  });

  it('7. adds a sealed product using the same collection contract', () => {
    const result = addCollectionItem(
      [],
      {
        assetType: 'sealed',
        ownerId: 'mario',
        sealedProductId: 'sealed-op05-box',
        condition: 'factory_sealed',
        languageOrRegion: 'EN',
        quantity: 2,
      },
      { newItemId: 'new-sealed', newAcquisitionLotId: 'lot-new-sealed', now: NOW },
    );
    expect(result.status).toBe('added');
    if (result.status !== 'added') throw new Error('Expected a newly added sealed product.');
    expect(result.item).toMatchObject({ assetType: 'sealed', quantity: 2 });
  });

  it('8. requires confirmation for duplicates and merges quantity only when explicitly requested', () => {
    const first = addCollectionItem([], cardInput, {
      newItemId: 'card-existing',
      newAcquisitionLotId: 'lot-first',
      now: NOW,
      marketReferencesAtAdd: [
        { provider: 'cardmarket', currency: 'EUR', value: 12 },
        { provider: 'tcgplayer', currency: 'USD', value: 15 },
      ],
    });
    const existing = first.items;
    const duplicate = addCollectionItem(existing, { ...cardInput, quantity: 2 }, {
      newItemId: 'ignored',
      newAcquisitionLotId: 'lot-unconfirmed',
      now: LATER,
    });
    expect(duplicate.status).toBe('duplicate_confirmation_required');
    expect(duplicate.items).toHaveLength(1);
    expect(existing[0].quantity).toBe(1);
    expect(existing[0].acquisitionLots).toHaveLength(1);

    const merged = addCollectionItem(existing, {
      ...cardInput,
      quantity: 2,
      purchasePricePerUnit: { amount: 11, currency: 'EUR' },
    }, {
      newItemId: 'ignored',
      newAcquisitionLotId: 'lot-second',
      now: LATER,
      onDuplicate: 'merge',
      marketReferencesAtAdd: [
        { provider: 'cardmarket', currency: 'EUR', value: 14 },
        { provider: 'tcgplayer', currency: 'USD', value: 17 },
      ],
    });
    expect(merged.status).toBe('merged');
    if (merged.status !== 'merged') throw new Error('Expected the confirmed duplicate to merge.');
    expect(merged.items).toHaveLength(1);
    expect(merged.item.quantity).toBe(3);
    expect(merged.item.purchasePricePerUnit).toEqual({ amount: 10, currency: 'EUR' });
    expect(merged.item.acquiredAt).toBe('2026-06-30');
    expect(merged.item.acquisitionLots).toHaveLength(2);
    expect(merged.item.acquisitionLots[1]).toMatchObject({
      id: 'lot-second',
      collectionItemId: 'card-existing',
      addedAt: LATER,
      quantity: 2,
      marketReferences: [
        { provider: 'cardmarket', currency: 'EUR', value: 14, capturedAt: LATER },
        { provider: 'tcgplayer', currency: 'USD', value: 17, capturedAt: LATER },
      ],
    });
    expect(Object.isFrozen(merged.item.acquisitionLots)).toBe(true);
    expect(Object.isFrozen(merged.item.acquisitionLots[1])).toBe(true);
    expect(existing[0].quantity).toBe(1);
    expect(existing[0].acquisitionLots).toHaveLength(1);
  });

  it('validates provider-native currencies for nullable acquisition values', () => {
    expect(() => addCollectionItem([], cardInput, {
      newItemId: 'wrong-currency',
      newAcquisitionLotId: 'lot-wrong-currency',
      now: NOW,
      marketReferencesAtAdd: [{ provider: 'cardmarket', currency: 'USD', value: null }],
    })).toThrow(/native EUR/i);
  });

  it('9. joins the correct community with a valid active QR code', () => {
    const result = joinCommunityWithCode({
      enteredCode: ' berlin-harbor ',
      codes: [joinCode],
      memberships: [],
      userId: 'mario',
      now: NOW,
      newMembershipId: 'membership-new',
    });
    expect(result.status).toBe('joined');
    if (result.status === 'joined' || result.status === 'rejoined') {
      expect(result.membership.communityId).toBe('community-berlin');
      expect(result.updatedCode.useCount).toBe(1);
    }
  });

  it('10. rejects unknown, revoked, and expired QR codes', () => {
    const base = { memberships: [], userId: 'mario', now: NOW };
    expect(validateStoreJoin({ ...base, enteredCode: 'missing', codes: [joinCode] }).status).toBe('invalid');
    expect(validateStoreJoin({
      ...base,
      enteredCode: joinCode.publicCode,
      codes: [{ ...joinCode, active: false, revokedAt: '2026-06-01T00:00:00.000Z' }],
    }).status).toBe('revoked');
    expect(validateStoreJoin({
      ...base,
      enteredCode: joinCode.publicCode,
      codes: [{ ...joinCode, expiresAt: '2026-06-01T00:00:00.000Z' }],
    }).status).toBe('expired');
  });

  it('11. prevents duplicate active community memberships', () => {
    const existing = member('membership-existing', 'mario');
    const result = joinCommunityWithCode({
      enteredCode: joinCode.publicCode,
      codes: [joinCode],
      memberships: [existing],
      userId: 'mario',
      now: NOW,
      newMembershipId: 'must-not-be-created',
    });
    expect(result.status).toBe('already_member');
  });

  it('12. denies community content to non-members', () => {
    const messages: CommunityMessage[] = [
      {
        id: 'chat-1',
        communityId: 'community-berlin',
        authorId: 'member-a',
        body: 'Private community message',
        sentAt: NOW,
      },
    ];
    expect(() => communityMessagesForViewer(messages, [], 'outsider', 'community-berlin'))
      .toThrow(/membership is required/i);
    expect(communityMessagesForViewer(messages, [member('m1', 'member-a')], 'member-a', 'community-berlin'))
      .toHaveLength(1);
  });

  it('13. rejects any attempted user-entered price-like trade field, including nested fields', () => {
    expect(() => parseTradePostDraft({ ...tradeDraft, askingPrice: 40 })).toThrow(/price-like field/i);
    expect(() => parseTradePostDraft({
      ...tradeDraft,
      offeredItems: [{ ...tradeDraft.offeredItems[0], usdValue: 50 }],
    })).toThrow(/price-like field/i);
  });

  it('accepts English trade items and rejects German offered or wanted items', () => {
    expect(parseTradePostDraft(tradeDraft)).toMatchObject({
      offeredItems: [{ language: 'EN' }],
      wantedItems: [{ desiredLanguage: 'EN' }],
    });
    expect(() => parseTradePostDraft({
      ...tradeDraft,
      offeredItems: [{ ...tradeDraft.offeredItems[0], language: 'DE' }],
    })).toThrow(/offered language is invalid/i);
    expect(() => parseTradePostDraft({
      ...tradeDraft,
      wantedItems: [{ ...tradeDraft.wantedItems[0], desiredLanguage: 'DE' }],
    })).toThrow(/desired language is invalid/i);
  });

  it('14. accepts market references only through trusted context and keeps them read-only', () => {
    const post = createTradePost(tradeDraft, {
      id: 'trade-1',
      authorId: 'mario',
      now: NOW,
      memberships: [member('mario-membership', 'mario')],
      marketReferencesAtCreation: [
        {
          catalogItemId: CATALOG_ID,
          provider: 'cardmarket',
          currency: 'EUR',
          value: 12,
          capturedAt: NOW,
        },
      ],
    });
    expect(post.marketReferencesAtCreation[0]).toMatchObject({
      value: 12,
      readOnly: true,
      notice: 'Market reference only — not a sale price',
    });
    expect(Object.isFrozen(post.marketReferencesAtCreation)).toBe(true);
    expect(Object.isFrozen(post.marketReferencesAtCreation[0])).toBe(true);
    expect(() => parseTradePostDraft({ ...tradeDraft, marketReferences: [] })).toThrow(/price-like field/i);
  });

  it('15. allows direct messaging when both users share an active community', () => {
    const memberships = [member('mario-member', 'mario'), member('nami-member', 'nami')];
    expect(authorizeDirectConversation('mario', 'nami', memberships)).toEqual({
      allowed: true,
      sharedCommunityIds: ['community-berlin'],
    });
    const conversation = createDirectConversation({
      id: 'conversation-1',
      initiatorId: 'mario',
      recipientId: 'nami',
      memberships,
      now: NOW,
    });
    expect(conversation.sharedCommunityId).toBe('community-berlin');
  });

  it('16. denies direct messaging without a shared active community', () => {
    const memberships = [
      member('mario-member', 'mario', 'community-berlin'),
      member('nami-member', 'nami', 'community-hamburg'),
    ];
    expect(authorizeDirectConversation('mario', 'nami', memberships)).toEqual({
      allowed: false,
      reason: 'no_shared_community',
    });
    expect(() => createDirectConversation({
      id: 'denied-conversation',
      initiatorId: 'mario',
      recipientId: 'nami',
      memberships,
      now: NOW,
    })).toThrow(/shared active community/i);
  });

  it('17. exposes direct conversations and messages only to their two participants', () => {
    const memberships = [member('mario-member', 'mario'), member('nami-member', 'nami')];
    const conversation = createDirectConversation({
      id: 'conversation-private',
      initiatorId: 'mario',
      recipientId: 'nami',
      memberships,
      now: NOW,
    });
    const messages: DirectMessage[] = [{
      id: 'dm-1',
      conversationId: conversation.id,
      senderId: 'mario',
      body: 'Private hello',
      sentAt: NOW,
    }];
    expect(canReadDirectConversation('mario', conversation)).toBe(true);
    expect(canReadDirectConversation('nami', conversation)).toBe(true);
    expect(canReadDirectConversation('store-admin', conversation)).toBe(false);
    expect(() => directMessagesForViewer('store-admin', conversation, messages))
      .toThrow(/only to their participants/i);
  });

  it('18. keeps collections and purchase data private and discloses only explicitly offered fields', () => {
    const added = addCollectionItem([], cardInput, {
      newItemId: 'private-card',
      newAcquisitionLotId: 'lot-private-card',
      now: NOW,
    });
    if (added.status !== 'added') throw new Error('Expected the private card to be added.');
    const item = added.item as CollectionItem;
    expect(() => privateCollectionForViewer('outsider', 'mario', [item]))
      .toThrow(/private to their owner/i);
    const disclosure = toPublicTradeHoldingDisclosure(item, 1);
    expect(disclosure).toEqual({
      assetType: 'card',
      catalogItemId: CATALOG_ID,
      quantity: 1,
      condition: 'near_mint',
      language: 'EN',
    });
    expect(disclosure).not.toHaveProperty('purchasePricePerUnit');
    expect(disclosure).not.toHaveProperty('privateNote');
    expect(disclosure).not.toHaveProperty('ownerId');
  });
});
