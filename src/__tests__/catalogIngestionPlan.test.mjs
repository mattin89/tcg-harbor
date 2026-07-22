import { describe, expect, it } from 'vitest';
import {
  PRODUCT_LEVEL_PRICE_SCOPE,
  activeManagedRowsMissingFromPlan,
  activeCatalogRemovalApprovalIds,
  assertManagedCatalogContinuity,
  assertSnapshotCanAdvanceProviders,
  catalogSetCodeIsReleased,
  officialMemberSetCodesFromLabel,
  officialProductCodeFromTitle,
  officialSetCodeReleaseState,
  pricingConditionForAsset,
  productLevelMappingMetadata,
  providerMappingCanReuseActiveIdentity,
  providerMappingStableSeed,
  providerMappingVersionSeed,
} from '../../scripts/lib/catalog-ingestion-plan.mjs';

describe('catalog ingestion plan', () => {
  it('refuses to overwrite a newer successful provider state with an older snapshot', () => {
    expect(() => assertSnapshotCanAdvanceProviders('2026-07-20T00:00:00.000Z', [
      { slug: 'cardmarket', last_sync_at: '2026-07-21T00:00:00.000Z' },
    ])).toThrow(/older than cardmarket state/i);
    expect(() => assertSnapshotCanAdvanceProviders('2026-07-21T00:00:00.000Z', [
      { slug: 'cardmarket', last_sync_at: '2026-07-21T00:00:00.000Z' },
      { slug: 'tcgplayer', last_sync_at: null },
    ])).not.toThrow();
  });

  it('keeps one product-level Near Mint card reference and sealed products sealed-only', () => {
    expect(pricingConditionForAsset('card')).toBe('near_mint');
    expect(pricingConditionForAsset('sealed')).toBe('sealed');
  });

  it('gives each provider/asset/condition mapping a deterministic seed', () => {
    expect(providerMappingStableSeed(
      'cardmarket',
      'card-op01-001-base',
      'near_mint',
    )).toBe('cardmarket:card-op01-001-base:near_mint');
  });

  it('gives every replacement provider identity a distinct deterministic version seed', () => {
    const first = providerMappingVersionSeed(
      'cardmarket',
      'card-op01-001-base',
      'near_mint',
      '719388',
    );
    const replacement = providerMappingVersionSeed(
      'cardmarket',
      'card-op01-001-base',
      'near_mint',
      '719387',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(first).toBe(providerMappingVersionSeed(
      'cardmarket',
      'card-op01-001-base',
      'near_mint',
      '719388',
    ));
    expect(replacement).not.toBe(first);
    expect(() => providerMappingVersionSeed('', 'asset', 'near_mint', '1'))
      .toThrow(/every identity component/i);
  });

  it('treats a missing prior provider mapping as a new identity instead of dereferencing it', () => {
    expect(providerMappingCanReuseActiveIdentity(undefined, '719388')).toBe(false);
    expect(providerMappingCanReuseActiveIdentity(null, '719388')).toBe(false);
    expect(providerMappingCanReuseActiveIdentity({
      disabled_at: null,
      provider_product_id: '719388',
    }, '719388')).toBe(true);
    expect(providerMappingCanReuseActiveIdentity({
      disabled_at: '2026-07-22T00:00:00.000Z',
      provider_product_id: '719388',
    }, '719388')).toBe(false);
    expect(providerMappingCanReuseActiveIdentity({
      disabled_at: null,
      provider_product_id: '719387',
    }, '719388')).toBe(false);
  });

  it('states explicitly that copied condition rows use a product-level reference', () => {
    expect(productLevelMappingMetadata({
      assetId: 'card-op01-001-base',
      source: 'Cardmarket public feed',
      syncRunId: 'run-123',
      syncGeneratedAt: '2026-07-21T12:00:00.000Z',
    })).toEqual({
      tcg_harbor_asset_id: 'card-op01-001-base',
      source: 'Cardmarket public feed',
      price_scope: PRODUCT_LEVEL_PRICE_SCOPE,
      condition_adjusted: false,
      condition_value_policy: 'single_verified_product_reference_with_condition_agnostic_valuation_fallback',
      catalog_sync_run_id: 'run-123',
      catalog_sync_generated_at: '2026-07-21T12:00:00.000Z',
      tcg_harbor_game_slug: 'one-piece-card-game',
    });
  });

  it('retires only active importer-managed rows absent from the current plan', () => {
    const rows = [
      { id: 'current', archived_at: null, external_identifiers: { tcg_harbor_asset_id: 'asset-current' } },
      { id: 'stale', archived_at: null, external_identifiers: { tcg_harbor_asset_id: 'asset-stale' } },
      { id: 'manual', archived_at: null, external_identifiers: {} },
      { id: 'already-retired', archived_at: '2026-01-01T00:00:00Z', external_identifiers: { tcg_harbor_asset_id: 'asset-old' } },
    ];

    expect(activeManagedRowsMissingFromPlan(rows, new Set(['current']), {
      inactiveField: 'archived_at',
      managedAssetId: (row) => row.external_identifiers.tcg_harbor_asset_id,
    }).map((row) => row.id)).toEqual(['stale']);
  });

  it('release-gates every recognized member of combined Bandai set labels', () => {
    expect(officialMemberSetCodesFromLabel('OP17-EB05')).toEqual(['OP17', 'EB05']);
    expect(catalogSetCodeIsReleased('OP14-EB04', new Set(['OP14', 'EB04']))).toBe(true);
    expect(catalogSetCodeIsReleased('OP17-EB05', new Set(['OP17']))).toBe(false);
    expect(catalogSetCodeIsReleased('PROMO', new Set())).toBe(true);
  });

  it('fails closed for recognizable sealed set codes absent from the Bandai manifest', () => {
    const released = new Set(['OP16', 'ST30']);
    const future = new Set(['OP17', 'ST31']);

    expect(officialSetCodeReleaseState('OP16', released, future)).toBe('released');
    expect(officialSetCodeReleaseState('ST31', released, future)).toBe('future');
    expect(officialSetCodeReleaseState('OP18', released, future)).toBe('unknown');
    expect(officialSetCodeReleaseState('ST37', released, future)).toBe('unknown');
    expect(officialSetCodeReleaseState('DECK', released, future)).toBe('unmanaged');
  });

  it('parses legacy Bandai product codes written with full-width brackets', () => {
    expect(officialProductCodeFromTitle('STARTER DECK ONE PIECE FILM edition【ST-05】')).toBe('ST-05');
    expect(officialProductCodeFromTitle('BOOSTER PACK [OP-16]')).toBe('OP-16');
  });

  it('fails closed when a managed catalog asset disappears without review', () => {
    const previous = [
      { id: 'kept', kind: 'card', setCode: 'OP01' },
      { id: 'missing', kind: 'card', setCode: 'ST05' },
    ];
    expect(() => assertManagedCatalogContinuity(previous, [previous[0]], new Set()))
      .toThrow(/unapproved asset removals/i);
    expect(assertManagedCatalogContinuity(previous, [previous[0]], new Set(['missing'])))
      .toEqual([previous[1]]);
  });

  it('expires presale-remediation removal approvals on the official release date', () => {
    const approvals = new Map([['sealed-future', {
      reason: 'Presale remediation',
      expiresAt: '2026-07-31T00:00:00.000Z',
    }]]);
    expect(activeCatalogRemovalApprovalIds(approvals, '2026-07-30T23:59:59.000Z')).toEqual(new Set(['sealed-future']));
    expect(activeCatalogRemovalApprovalIds(approvals, '2026-07-31T00:00:00.000Z')).toEqual(new Set());
  });

  it('keeps reviewed non-products permanently excluded without an arbitrary expiry', () => {
    const approvals = new Map([['sealed-empty-box', {
      reason: 'Empty packaging is not a sealed card-game product',
      permanent: true,
    }]]);
    expect(activeCatalogRemovalApprovalIds(approvals, '2126-01-01T00:00:00.000Z'))
      .toEqual(new Set(['sealed-empty-box']));
  });
});
