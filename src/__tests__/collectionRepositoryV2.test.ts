import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { catalogAssets } from '../data/demo';
import { SupabaseCollectionRepositoryV2 } from '../services/supabase/collectionRepositoryV2';

type MockRow = Record<string, unknown>;

class MockQuery {
  constructor(
    private readonly table: string,
    private readonly rows: readonly MockRow[],
    private readonly ranges: Record<string, Array<[number, number]>>,
    private readonly missingDailySnapshots: boolean,
    private readonly selectedColumns?: Record<string, string[]>,
  ) {}

  select(columns = '*'): this {
    if (this.selectedColumns) {
      (this.selectedColumns[this.table] ??= []).push(columns);
    }
    return this;
  }
  is(): this { return this; }
  order(): this { return this; }

  range(from: number, to: number) {
    (this.ranges[this.table] ??= []).push([from, to]);
    if (this.table === 'collection_daily_valuation_snapshots' && this.missingDailySnapshots) {
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST205', message: "Could not find the table in the schema cache" },
      });
    }
    return Promise.resolve({ data: this.rows.slice(from, to + 1), error: null });
  }
}

describe('SupabaseCollectionRepositoryV2', () => {
  it('binds collection adds to the owner who started the mutation', async () => {
    const catalogAsset = catalogAssets.find((asset) => asset.kind === 'card');
    expect(catalogAsset).toBeDefined();

    const calls: Array<{ functionName: string; params: Record<string, unknown> }> = [];
    const lookup = {
      select() { return this; },
      contains() { return this; },
      is() { return this; },
      limit() {
        return Promise.resolve({ data: [{ id: 'variant-1' }], error: null });
      },
    };
    const client = {
      from() { return lookup; },
      rpc(functionName: string, params: Record<string, unknown>) {
        calls.push({ functionName, params });
        return Promise.resolve({ data: null, error: null });
      },
    } as unknown as SupabaseClient;

    await new SupabaseCollectionRepositoryV2(client).add({
      asset: catalogAsset!,
      condition: 'Near Mint',
      quantity: 1,
    }, 'account-a');

    expect(calls).toHaveLength(1);
    expect(calls[0].functionName).toBe('add_or_merge_collection_item_v2');
    expect(calls[0].params.p_expected_owner_id).toBe('account-a');
  });

  it('paginates owner-scoped collection and daily-history reads', async () => {
    const catalogAsset = catalogAssets.find((asset) => asset.kind === 'card');
    expect(catalogAsset).toBeDefined();

    const collectionItemId = 'collection-item-1';
    const acquisitionLots = Array.from({ length: 1_001 }, (_, index) => ({
      id: index + 1,
      collection_item_id: collectionItemId,
      added_quantity: 1,
      captured_at: new Date(2026, 0, 1, 0, 0, index).toISOString(),
    }));
    const acquisitionReferences = acquisitionLots.map((lot) => ({
      acquisition_lot_id: lot.id,
      provider_id: 'provider-cardmarket',
      currency: 'EUR',
      market_value: 1,
      trend_value: 1.25,
    }));
    const rowsByTable: Record<string, readonly MockRow[]> = {
      collection_items: [{
        id: collectionItemId,
        card_variant_id: 'variant-1',
        sealed_product_id: null,
        condition: 'near_mint',
        language: 'English',
        quantity: 1_001,
        acquired_on: '2026-01-01',
        purchase_unit_amount: null,
        purchase_currency: null,
        private_note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        card_variant: { external_identifiers: { tcg_harbor_asset_id: catalogAsset!.id } },
        sealed_product: null,
      }],
      collection_acquisition_lots: acquisitionLots,
      collection_acquisition_market_references: acquisitionReferences,
      pricing_providers: [{ id: 'provider-cardmarket', slug: 'cardmarket' }],
      collection_daily_valuation_snapshots: [],
    };
    const ranges: Record<string, Array<[number, number]>> = {};
    const client = {
      from(table: string) {
        return new MockQuery(table, rowsByTable[table] ?? [], ranges, false);
      },
    } as unknown as SupabaseClient;

    const snapshot = await new SupabaseCollectionRepositoryV2(client).load([catalogAsset!]);

    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.assets[0].acquisitionLots).toHaveLength(1_001);
    expect(snapshot.dailySnapshots).toEqual([]);
    expect(ranges.collection_acquisition_lots).toEqual([[0, 999], [1_000, 1_999]]);
    expect(ranges.collection_acquisition_market_references).toEqual([[0, 999], [1_000, 1_999]]);
    expect(ranges.collection_items).toEqual([[0, 999]]);
    expect(ranges.pricing_providers).toEqual([[0, 999]]);
    expect(ranges.collection_daily_valuation_snapshots).toEqual([[0, 999]]);
  });

  it.each(['PGRST205', '42P01'])(
    'fails closed when durable daily history is unavailable with %s',
    async (errorCode) => {
      const ranges: Record<string, Array<[number, number]>> = {};
      const client = {
        from(table: string) {
          const query = new MockQuery(table, [], ranges, false);
          if (table !== 'collection_daily_valuation_snapshots') return query;
          return {
            select() { return this; },
            order() { return this; },
            range() {
              return Promise.resolve({
                data: null,
                error: { code: errorCode, message: 'Daily valuation history is unavailable' },
              });
            },
          };
        },
      } as unknown as SupabaseClient;

      await expect(new SupabaseCollectionRepositoryV2(client).load([]))
        .rejects.toThrow(/Load portfolio history: Daily valuation history is unavailable/);
    },
  );

  it('keeps archived card and sealed holdings visible as private null-priced fallbacks', async () => {
    const rowsByTable: Record<string, readonly MockRow[]> = {
      collection_items: [
        {
          id: 'archived-card-item',
          card_variant_id: 'archived-variant',
          sealed_product_id: null,
          condition: 'near_mint',
          language: 'EN',
          quantity: 2,
          acquired_on: '2025-05-01',
          purchase_unit_amount: 4.5,
          purchase_currency: 'EUR',
          private_note: 'Keep this history',
          created_at: '2025-05-01T12:00:00.000Z',
          card_variant: {
            id: 'archived-variant',
            variant_identifier: 'alternate-art-2',
            variant_name: 'Alternate Art',
            language: 'EN',
            image_url: 'https://images.example.test/archived-card.jpg',
            external_identifiers: { tcg_harbor_asset_id: 'retired-catalog-card' },
            archived_at: '2026-07-20T00:00:00.000Z',
            card: {
              id: 'archived-card',
              card_number: 'OP08-001',
              name: 'Archived Leader',
              rarity: 'L',
              card_type: 'Leader',
              colors: ['Red'],
              image_url: null,
              release_date: '2024-09-13',
              external_identifiers: {},
              archived_at: '2026-07-20T00:00:00.000Z',
              card_set: {
                id: 'archived-set',
                code: 'OP08',
                name: 'Two Legends',
                release_date: '2024-09-13',
                image_url: null,
                external_identifiers: {},
                archived_at: '2026-07-20T00:00:00.000Z',
              },
            },
          },
          sealed_product: null,
        },
        {
          id: 'archived-sealed-item',
          card_variant_id: null,
          sealed_product_id: 'archived-sealed',
          condition: 'sealed',
          language: 'EN',
          quantity: 1,
          acquired_on: '2025-06-01',
          purchase_unit_amount: null,
          purchase_currency: null,
          private_note: null,
          created_at: '2025-06-01T12:00:00.000Z',
          card_variant: null,
          sealed_product: {
            id: 'archived-sealed',
            name: 'Retired Booster Box',
            product_type: 'booster_box',
            language: 'EN',
            region: 'Europe',
            image_url: null,
            release_date: '2024-09-13',
            external_identifiers: {},
            archived_at: '2026-07-20T00:00:00.000Z',
            card_set: {
              id: 'archived-set',
              code: 'OP08',
              name: 'Two Legends',
              release_date: '2024-09-13',
              image_url: null,
              external_identifiers: {},
              archived_at: '2026-07-20T00:00:00.000Z',
            },
          },
        },
      ],
      collection_acquisition_lots: [],
      collection_acquisition_market_references: [],
      pricing_providers: [],
      collection_daily_valuation_snapshots: [],
    };
    const ranges: Record<string, Array<[number, number]>> = {};
    const selectedColumns: Record<string, string[]> = {};
    const client = {
      from(table: string) {
        return new MockQuery(table, rowsByTable[table] ?? [], ranges, false, selectedColumns);
      },
    } as unknown as SupabaseClient;

    const snapshot = await new SupabaseCollectionRepositoryV2(client).load([]);

    expect(snapshot.unmappedHoldingCount).toBe(2);
    expect(snapshot.assets).toHaveLength(2);
    expect(snapshot.assets[0]).toMatchObject({
      id: 'holding-archived-card-item',
      catalogId: 'retired-catalog-card',
      kind: 'card',
      name: 'Archived Leader',
      set: 'Two Legends',
      setCode: 'OP08',
      number: 'OP08-001',
      variant: 'Alternate Art',
      language: 'English',
      quantity: 2,
      purchasePrice: 4.5,
      purchaseCurrency: 'EUR',
      quote: { cardmarket: null, tcgplayer: null },
      change: {
        cardmarket: { '1D': null, '1W': null, '1M': null },
        tcgplayer: { '1D': null, '1W': null, '1M': null },
      },
    });
    expect(snapshot.assets[1]).toMatchObject({
      id: 'holding-archived-sealed-item',
      catalogId: 'private-holding-archived-sealed-item',
      kind: 'sealed',
      name: 'Retired Booster Box',
      set: 'Two Legends',
      productType: 'Booster Box',
      language: 'English',
      condition: 'Factory sealed',
      quote: { cardmarket: null, tcgplayer: null },
      imageState: 'unavailable',
    });

    const collectionSelect = selectedColumns.collection_items.join('\n');
    expect(collectionSelect).toContain('card:cards!card_variants_card_id_fkey');
    expect(collectionSelect).toContain('card_set:card_sets!cards_set_game_fk');
    expect(collectionSelect).toContain('card_set:card_sets!sealed_products_set_game_fk');
  });
});
