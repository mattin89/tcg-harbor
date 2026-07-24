import { describe, expect, it } from 'vitest';
import {
  eurosToCentsV6,
  tradeActionLabelV6,
  validateCommunityTradeDraftV6,
} from '../domain/communityTradingV6';

const baseDraft = {
  communityId: 'community-dresden',
  postKind: 'offering_card' as const,
  exchangeMode: 'money' as const,
  primaryAssetId: 'card-op01-001',
  quantity: 1,
  desiredCondition: 'near_mint' as const,
};

describe('community card trading v6', () => {
  it('stores euro values as exact cents and treats zero as a valid giveaway', () => {
    expect(eurosToCentsV6('0', true)).toBe(0);
    expect(eurosToCentsV6('12,34', true)).toBe(1234);
    expect(validateCommunityTradeDraftV6({ ...baseDraft, cashAmountEuros: '0.00' }))
      .toMatchObject({ cashAmountCents: 0 });
    expect(tradeActionLabelV6({
      postKind: 'offering_card',
      exchangeMode: 'money',
      cashAmountCents: 0,
    })).toMatch(/free giveaway/i);
  });

  it('requires an asking amount for an offered card but permits an unspecified buying budget', () => {
    expect(() => validateCommunityTradeDraftV6(baseDraft)).toThrow(/asking price/i);
    expect(validateCommunityTradeDraftV6({
      ...baseDraft,
      postKind: 'seeking_card',
    })).toMatchObject({ cashAmountCents: null });
  });

  it('supports any-card, specific-card, and open terms without a cash field', () => {
    for (const exchangeMode of ['any_card', 'open'] as const) {
      expect(validateCommunityTradeDraftV6({
        ...baseDraft,
        exchangeMode,
        cashAmountEuros: undefined,
      })).toMatchObject({ cashAmountCents: null });
    }
    expect(validateCommunityTradeDraftV6({
      ...baseDraft,
      exchangeMode: 'specific_card',
      specificAssetId: 'card-op02-002',
      cashAmountEuros: undefined,
    })).toMatchObject({ cashAmountCents: null });
  });

  it('rejects ambiguous specific-card and cash combinations', () => {
    expect(() => validateCommunityTradeDraftV6({
      ...baseDraft,
      exchangeMode: 'specific_card',
      cashAmountEuros: undefined,
    })).toThrow(/specific card/i);
    expect(() => validateCommunityTradeDraftV6({
      ...baseDraft,
      exchangeMode: 'specific_card',
      specificAssetId: baseDraft.primaryAssetId,
      cashAmountEuros: undefined,
    })).toThrow(/different/i);
    expect(() => validateCommunityTradeDraftV6({
      ...baseDraft,
      exchangeMode: 'open',
      cashAmountEuros: '10',
    })).toThrow(/money option/i);
  });
});
