import { beforeEach, describe, expect, it } from 'vitest';
import type { DemoAsset } from '../data/demo';
import {
  applyCatalogOverrides,
  approveAllVerifiedItems,
  approveCatalogAsset,
  clearAllAdminCatalogOverrides,
  diagnoseCatalogItem,
  exportCatalogOverridesJson,
  getAdminApprovedAssetIds,
  getAdminCatalogOverrides,
  importCatalogOverridesJson,
  isCatalogAssetApproved,
  resetAdminCatalogOverride,
  revokeCatalogAssetApproval,
  saveAdminCatalogOverride,
  type AdminCatalogOverride,
} from '../services/adminCatalogStore';

const mockBaseAsset: DemoAsset = {
  id: 'card-optcg-op01-001',
  kind: 'card',
  name: 'Roronoa Zoro',
  set: 'Romance Dawn',
  setCode: 'OP-01',
  number: 'OP01-001',
  rarity: 'L',
  variant: 'Leader',
  language: 'English',
  condition: 'Near Mint',
  quantity: 1,
  addedAt: '2026-01-01T00:00:00.000Z',
  color: 'red',
  imageUrl: 'https://example.com/zoro.jpg',
  imageState: 'available',
  cardmarketProductId: 12345,
  cardmarketExpansionId: 100,
  cardmarketPriceState: 'available',
  tcgplayerProductId: 67890,
  tcgplayerPriceState: 'available',
  quote: { cardmarket: 45.0, tcgplayer: 50.0 },
  change: { cardmarket: { '1D': 0, '1W': 0, '1M': 0 }, tcgplayer: { '1D': 0, '1W': 0, '1M': 0 } },
  pricing: {
    cardmarket: { trend: 45.0, low: 40.0, average: 44.0, average1Day: null, average7Days: null, average30Days: null },
    usMarket: { market: 50.0, inventory: null },
  },
};

const mockErrorAsset: DemoAsset = {
  id: 'card-tcgplayer-999999',
  kind: 'card',
  name: 'Mystery Trophy Card',
  set: 'Special Tournaments Promos',
  setCode: 'STP',
  number: 'P-MYSTERY',
  rarity: 'PR',
  variant: 'Promo',
  language: 'English',
  condition: 'Near Mint',
  quantity: 1,
  addedAt: '2026-01-01T00:00:00.000Z',
  color: 'amber',
  imageUrl: '',
  imageState: 'unavailable',
  cardmarketPriceState: 'unmapped',
  cardmarketPriceReason: 'Unmapped promo',
  tcgplayerPriceState: 'unavailable',
  quote: { cardmarket: null, tcgplayer: null },
  change: { cardmarket: { '1D': null, '1W': null, '1M': null }, tcgplayer: { '1D': null, '1W': null, '1M': null } },
  pricing: {
    cardmarket: { trend: null, low: null, average: null, average1Day: null, average7Days: null, average30Days: null },
    usMarket: { market: null, inventory: null },
  },
};

describe('adminCatalogStore', () => {
  beforeEach(() => {
    clearAllAdminCatalogOverrides();
  });

  it('diagnoses unmapped, missing image, and unpriced assets as errors', () => {
    const cleanDiag = diagnoseCatalogItem(mockBaseAsset);
    expect(cleanDiag.isFlaggedOrError).toBe(false);
    expect(cleanDiag.issues).toHaveLength(0);

    const errorDiag = diagnoseCatalogItem(mockErrorAsset);
    expect(errorDiag.isFlaggedOrError).toBe(true);
    expect(errorDiag.issues).toContain('unmapped-cardmarket');
    expect(errorDiag.issues).toContain('missing-image');
    expect(errorDiag.issues).toContain('price-unavailable');

    const flaggedDiag = diagnoseCatalogItem(mockBaseAsset, new Set([mockBaseAsset.id]));
    expect(flaggedDiag.isFlaggedOrError).toBe(true);
    expect(flaggedDiag.issues).toContain('continuity-flagged');
  });

  it('persists, updates, and resets overrides in localStorage', () => {
    expect(getAdminCatalogOverrides()).toEqual({});

    const patch: AdminCatalogOverride = {
      id: mockBaseAsset.id,
      name: 'Roronoa Zoro (Alt Art Edit)',
      cardmarketTrendPrice: 85.5,
      updatedAt: '2026-09-14T12:00:00.000Z',
    };

    saveAdminCatalogOverride(patch);
    const loaded = getAdminCatalogOverrides();
    expect(loaded[mockBaseAsset.id]?.name).toBe('Roronoa Zoro (Alt Art Edit)');
    expect(loaded[mockBaseAsset.id]?.cardmarketTrendPrice).toBe(85.5);

    resetAdminCatalogOverride(mockBaseAsset.id);
    expect(getAdminCatalogOverrides()[mockBaseAsset.id]).toBeUndefined();
  });

  it('applies overrides and resolves error state when errorResolved is set', () => {
    const patch: AdminCatalogOverride = {
      id: mockErrorAsset.id,
      imageUrl: '/catalog/cards/fixed.jpg',
      cardmarketProductId: 999999,
      cardmarketTrendPrice: 120.0,
      errorResolved: true,
      adminNote: 'Manually verified against tournament listing',
      updatedAt: '2026-09-14T12:00:00.000Z',
    };

    const applied = applyCatalogOverrides([mockErrorAsset], { [mockErrorAsset.id]: patch });
    const resolvedItem = applied[0];

    expect(resolvedItem.imageUrl).toBe('/catalog/cards/fixed.jpg');
    expect(resolvedItem.imageState).toBe('available');
    expect(resolvedItem.cardmarketProductId).toBe(999999);
    expect(resolvedItem.cardmarketPriceState).toBe('available');
    expect(resolvedItem.quote.cardmarket).toBe(120.0);
    expect(resolvedItem.pricing?.cardmarket?.trend).toBe(120.0);
    expect(resolvedItem.note).toContain('Admin: Manually verified against tournament listing');

    const diagAfterResolve = diagnoseCatalogItem(resolvedItem);
    expect(diagAfterResolve.issues).not.toContain('unmapped-cardmarket');
    expect(diagAfterResolve.issues).not.toContain('missing-image');
  });

  it('exports and imports overrides JSON accurately', () => {
    saveAdminCatalogOverride({
      id: 'card-1',
      name: 'Exported Test Card',
      cardmarketTrendPrice: 15.0,
      updatedAt: '2026-09-14T12:00:00.000Z',
    });

    const json = exportCatalogOverridesJson();
    expect(json).toContain('Exported Test Card');

    clearAllAdminCatalogOverrides();
    expect(getAdminCatalogOverrides()).toEqual({});

    const result = importCatalogOverridesJson(json);
    expect(result.error).toBeNull();
    expect(result.imported).toBe(1);
    expect(getAdminCatalogOverrides()['card-1']?.name).toBe('Exported Test Card');
  });

  it('manages card approval lifecycle and bulk approves verified items', () => {
    // Initially no cards approved
    expect(getAdminApprovedAssetIds().size).toBe(0);
    expect(isCatalogAssetApproved(mockBaseAsset)).toBe(false);

    // Approve individual asset
    approveCatalogAsset(mockBaseAsset.id);
    expect(getAdminApprovedAssetIds().has(mockBaseAsset.id)).toBe(true);
    expect(isCatalogAssetApproved(mockBaseAsset)).toBe(true);

    // Revoke individual approval
    revokeCatalogAssetApproval(mockBaseAsset.id);
    expect(getAdminApprovedAssetIds().has(mockBaseAsset.id)).toBe(false);
    expect(isCatalogAssetApproved(mockBaseAsset)).toBe(false);

    // Bulk approve all verified cards: mockBaseAsset is healthy, mockErrorAsset has issues
    const { approvedCount, totalVerified } = approveAllVerifiedItems([mockBaseAsset, mockErrorAsset]);
    expect(totalVerified).toBe(1);
    expect(approvedCount).toBe(1);
    expect(getAdminApprovedAssetIds().has(mockBaseAsset.id)).toBe(true);
    expect(getAdminApprovedAssetIds().has(mockErrorAsset.id)).toBe(false);

    // Applying overrides propagates isApproved
    const applied = applyCatalogOverrides([mockBaseAsset, mockErrorAsset]);
    expect(applied[0].isApproved).toBe(true);
    expect(applied[0].approvedAt).toBeDefined();
    expect(applied[1].isApproved).toBe(false);

    // Exporting and re-importing preserves approved IDs
    const exported = exportCatalogOverridesJson();
    clearAllAdminCatalogOverrides();
    expect(getAdminApprovedAssetIds().size).toBe(0);

    const importRes = importCatalogOverridesJson(exported);
    expect(importRes.error).toBeNull();
    expect(getAdminApprovedAssetIds().has(mockBaseAsset.id)).toBe(true);
  });
});

