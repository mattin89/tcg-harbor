import type { SupabaseClient } from '@supabase/supabase-js';
import type { AcquisitionLot, Currency, DemoAsset, Market } from '../../data/demo';

type JsonRecord = Record<string, unknown>;

interface DataApiError {
  readonly code?: string;
  readonly message: string;
}

interface DataPage<T> {
  readonly data: T[] | null;
  readonly error: DataApiError | null;
}

const DATA_API_PAGE_SIZE = 1_000;

interface CardSetRelationRow {
  id: string;
  code: string;
  name: string;
  release_date: string | null;
  image_url: string | null;
  external_identifiers: JsonRecord;
  archived_at: string | null;
}

interface CardRelationRow {
  id: string;
  card_number: string;
  name: string;
  rarity: string;
  card_type: string;
  colors: string[];
  image_url: string | null;
  release_date: string | null;
  external_identifiers: JsonRecord;
  archived_at: string | null;
  card_set: CardSetRelationRow | null;
}

interface CardVariantRelationRow {
  id: string;
  variant_identifier: string;
  variant_name: string;
  language: string;
  image_url: string | null;
  external_identifiers: JsonRecord;
  archived_at: string | null;
  card: CardRelationRow | null;
}

interface SealedProductRelationRow {
  id: string;
  name: string;
  product_type: string;
  language: string;
  region: string | null;
  image_url: string | null;
  release_date: string | null;
  external_identifiers: JsonRecord;
  archived_at: string | null;
  card_set: CardSetRelationRow | null;
}

interface CollectionRow {
  id: string;
  card_variant_id: string | null;
  sealed_product_id: string | null;
  condition: string;
  language: string;
  quantity: number;
  acquired_on: string | null;
  purchase_unit_amount: number | string | null;
  purchase_currency: Currency | null;
  private_note: string | null;
  created_at: string;
  card_variant: CardVariantRelationRow | null;
  sealed_product: SealedProductRelationRow | null;
}

interface AcquisitionRow {
  id: number;
  collection_item_id: string;
  added_quantity: number;
  purchase_unit_amount: number | string | null;
  purchase_currency: Currency | null;
  captured_at: string;
}

interface AcquisitionReferenceRow {
  acquisition_lot_id: number;
  provider_id: string;
  currency: Currency | null;
  market_value: number | string | null;
  trend_value: number | string | null;
}

interface ProviderRow {
  id: string;
  slug: string;
}

interface DailySnapshotRow {
  owner_id: string;
  provider_id: string;
  snapshot_date: string;
  currency: Currency;
  market_value: number | string | null;
  acquisition_value: number | string | null;
  absolute_growth: number | string | null;
  growth_percentage: number | string | null;
  item_count: number;
  unit_count: number;
  priced_unit_count: number;
  unpriced_unit_count: number;
  acquisition_priced_unit_count: number;
  acquisition_unpriced_unit_count: number;
  latest_price_observed_at: string | null;
  captured_at: string;
  updated_at: string;
}

export interface PortfolioDailySnapshotV2 {
  readonly provider: Market;
  readonly date: string;
  readonly currency: Currency;
  readonly marketValue: number | null;
  readonly acquisitionValue: number | null;
  readonly absoluteGrowth: number | null;
  readonly growthPercentage: number | null;
  readonly itemCount: number;
  readonly unitCount: number;
  readonly pricedUnitCount: number;
  readonly unpricedUnitCount: number;
  readonly acquisitionPricedUnitCount: number;
  readonly acquisitionUnpricedUnitCount: number;
  readonly sourceObservedAt: string | null;
  readonly generatedAt: string;
}

export interface ProductionCollectionSnapshotV2 {
  readonly assets: DemoAsset[];
  readonly dailySnapshots: PortfolioDailySnapshotV2[];
  readonly unmappedHoldingCount: number;
}

export interface AddCollectionItemV2 {
  readonly asset: DemoAsset;
  readonly condition: string;
  readonly quantity: number;
  readonly privateNote?: string;
  readonly purchaseUnitAmount?: number;
  readonly purchaseCurrency?: Currency;
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function externalAssetId(record: JsonRecord | null | undefined): string | null {
  if (!record) return null;
  const value = record.tcg_harbor_asset_id ?? record.tcgHarborAssetId ?? record.source_asset_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nonEmpty(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function humanizeDatabaseValue(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLocaleLowerCase('en-US')}`)
    .join(' ');
}

function languageFromDatabase(value: string): string {
  const languageNames: Record<string, string> = {
    EN: 'English',
    DE: 'German',
    FR: 'French',
    IT: 'Italian',
    ES: 'Spanish',
    PT: 'Portuguese',
    JP: 'Japanese',
    KR: 'Korean',
    ZH: 'Chinese',
  };
  return languageNames[value.toLocaleUpperCase('en-US')] ?? nonEmpty(value, 'Unknown');
}

function fallbackColor(colors: readonly string[]): string {
  const colorThemes: Record<string, string> = {
    red: 'rose',
    green: 'jade',
    blue: 'azure',
    purple: 'violet',
    black: 'indigo',
    yellow: 'amber',
  };
  return colorThemes[colors[0]?.toLocaleLowerCase('en-US')] ?? 'indigo';
}

function nullPriceChange(): DemoAsset['change'] {
  return {
    cardmarket: { '1D': null, '1W': null, '1M': null },
    tcgplayer: { '1D': null, '1W': null, '1M': null },
  };
}

/**
 * Builds an owner-private display record when a holding no longer has a row in
 * the managed in-app catalog. It deliberately carries no current market price:
 * archived catalog metadata is enough to keep the holding visible, but is not
 * evidence of a fresh quote.
 */
function archivedHoldingFallback(
  item: CollectionRow,
  sourceAssetId: string | null,
): DemoAsset {
  const privateCatalogId = sourceAssetId ?? `private-holding-${item.id}`;

  if (item.card_variant_id !== null) {
    const variant = item.card_variant;
    const card = variant?.card;
    const cardSet = card?.card_set;
    const imageUrl = variant?.image_url ?? card?.image_url ?? undefined;
    return {
      id: privateCatalogId,
      catalogId: privateCatalogId,
      kind: 'card',
      name: nonEmpty(card?.name, 'Archived card printing'),
      set: nonEmpty(cardSet?.name, 'Archived catalog record'),
      setCode: nonEmpty(cardSet?.code, 'ARCHIVED'),
      number: card?.card_number || undefined,
      rarity: nonEmpty(card?.rarity, 'Unknown'),
      variant: nonEmpty(variant?.variant_name, nonEmpty(variant?.variant_identifier, 'Archived printing')),
      language: languageFromDatabase(variant?.language ?? item.language),
      condition: conditionFromDatabase(item.condition),
      quantity: item.quantity,
      addedAt: item.created_at,
      color: fallbackColor(card?.colors ?? []),
      imageUrl,
      imageState: imageUrl ? 'available' : 'unavailable',
      imageUnavailableReason: imageUrl
        ? undefined
        : 'Artwork is unavailable for this archived account holding.',
      quote: { cardmarket: null, tcgplayer: null },
      change: nullPriceChange(),
    };
  }

  const product = item.sealed_product;
  const cardSet = product?.card_set;
  const productType = humanizeDatabaseValue(product?.product_type ?? 'sealed_product');
  const imageUrl = product?.image_url ?? cardSet?.image_url ?? undefined;
  return {
    id: privateCatalogId,
    catalogId: privateCatalogId,
    kind: 'sealed',
    name: nonEmpty(product?.name, 'Archived sealed product'),
    set: nonEmpty(cardSet?.name, 'Archived sealed products'),
    setCode: nonEmpty(cardSet?.code, 'SEALED'),
    rarity: 'Sealed',
    variant: `${productType} · Archived account record`,
    productType,
    language: languageFromDatabase(product?.language ?? item.language),
    condition: conditionFromDatabase(item.condition),
    quantity: item.quantity,
    addedAt: item.created_at,
    color: 'indigo',
    imageUrl,
    imageState: imageUrl ? 'available' : 'unavailable',
    imageUnavailableReason: imageUrl
      ? undefined
      : 'Artwork is unavailable for this archived account holding.',
    quote: { cardmarket: null, tcgplayer: null },
    change: nullPriceChange(),
  };
}

function conditionToDatabase(value: string): string {
  const normalized = value.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '_');
  const aliases: Record<string, string> = {
    factory_sealed: 'sealed',
    light_play: 'light_played',
    lightly_played: 'light_played',
  };
  return aliases[normalized] ?? normalized;
}

function conditionFromDatabase(value: string): string {
  if (value === 'sealed') return 'Factory sealed';
  return value.split('_').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

function providerMarket(slug: string): Market | null {
  const normalized = slug.toLocaleLowerCase('en-US');
  if (normalized.includes('cardmarket')) return 'cardmarket';
  if (normalized.includes('tcgplayer') || normalized.includes('tcgcsv')) return 'tcgplayer';
  return null;
}

function ensureResult<T>(data: T | null, error: DataApiError | null, operation: string): T {
  if (error) throw new Error(`${operation}: ${error.message}`);
  if (data === null) throw new Error(`${operation}: the database returned no result.`);
  return data;
}

async function readAllPages<T>(
  operation: string,
  fetchPage: (from: number, to: number) => PromiseLike<DataPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += DATA_API_PAGE_SIZE) {
    const result = await fetchPage(from, from + DATA_API_PAGE_SIZE - 1);
    const page = ensureResult(result.data, result.error, operation);
    rows.push(...page);
    if (page.length < DATA_API_PAGE_SIZE) return rows;
  }
}

/** Owner-scoped production adapter. All mutations use narrow database RPCs. */
export class SupabaseCollectionRepositoryV2 {
  constructor(private readonly client: SupabaseClient) {}

  async load(catalog: readonly DemoAsset[]): Promise<ProductionCollectionSnapshotV2> {
    const [items, lots, references, providers, dailyRows] = await Promise.all([
      readAllPages<CollectionRow>('Load collection', (from, to) => this.client
        .from('collection_items')
        .select(`
          id, card_variant_id, sealed_product_id, condition, language, quantity,
          acquired_on, purchase_unit_amount, purchase_currency, private_note, created_at,
          card_variant:card_variants!collection_items_card_variant_id_fkey(
            id, variant_identifier, variant_name, language, image_url,
            external_identifiers, archived_at,
            card:cards!card_variants_card_id_fkey(
              id, card_number, name, rarity, card_type, colors, image_url,
              release_date, external_identifiers, archived_at,
              card_set:card_sets!cards_set_game_fk(
                id, code, name, release_date, image_url, external_identifiers, archived_at
              )
            )
          ),
          sealed_product:sealed_products!collection_items_sealed_product_id_fkey(
            id, name, product_type, language, region, image_url, release_date,
            external_identifiers, archived_at,
            card_set:card_sets!sealed_products_set_game_fk(
              id, code, name, release_date, image_url, external_identifiers, archived_at
            )
          )
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<DataPage<CollectionRow>>),
      readAllPages<AcquisitionRow>('Load acquisition lots', (from, to) => this.client
        .from('collection_acquisition_lots')
        .select('id, collection_item_id, added_quantity, purchase_unit_amount, purchase_currency, captured_at')
        .order('captured_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<DataPage<AcquisitionRow>>),
      readAllPages<AcquisitionReferenceRow>('Load acquisition references', (from, to) => this.client
        .from('collection_acquisition_market_references')
        .select('acquisition_lot_id, provider_id, currency, market_value, trend_value')
        .order('acquisition_lot_id', { ascending: true })
        .order('provider_id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<DataPage<AcquisitionReferenceRow>>),
      readAllPages<ProviderRow>('Load pricing providers', (from, to) => this.client
        .from('pricing_providers')
        .select('id, slug')
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<DataPage<ProviderRow>>),
      readAllPages<DailySnapshotRow>('Load portfolio history', (from, to) => this.client
        .from('collection_daily_valuation_snapshots')
        .select(`
          owner_id, provider_id, snapshot_date, currency, market_value,
          acquisition_value, absolute_growth, growth_percentage, item_count,
          unit_count, priced_unit_count, unpriced_unit_count,
          acquisition_priced_unit_count, acquisition_unpriced_unit_count,
          latest_price_observed_at, captured_at, updated_at
        `)
        .order('snapshot_date', { ascending: true })
        .order('provider_id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<DataPage<DailySnapshotRow>>),
    ]);

    const catalogById = new Map(catalog.map((asset) => [asset.id, asset]));
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const referencesByLot = new Map<number, AcquisitionReferenceRow[]>();
    for (const reference of references) {
      referencesByLot.set(reference.acquisition_lot_id, [
        ...(referencesByLot.get(reference.acquisition_lot_id) ?? []),
        reference,
      ]);
    }
    const lotsByItem = new Map<string, AcquisitionRow[]>();
    for (const lot of lots) {
      lotsByItem.set(lot.collection_item_id, [...(lotsByItem.get(lot.collection_item_id) ?? []), lot]);
    }

    let unmappedHoldingCount = 0;
    const assets = items.flatMap((item): DemoAsset[] => {
      const sourceAssetId = externalAssetId(
        item.card_variant?.external_identifiers ?? item.sealed_product?.external_identifiers,
      );
      const catalogAsset = sourceAssetId ? catalogById.get(sourceAssetId) : undefined;
      if (!catalogAsset) {
        unmappedHoldingCount += 1;
      }
      const displayAsset = catalogAsset ?? archivedHoldingFallback(item, sourceAssetId);

      const acquisitionLots: AcquisitionLot[] = (lotsByItem.get(item.id) ?? []).map((lot) => {
        const quoteAtAdd: AcquisitionLot['quoteAtAdd'] = { cardmarket: null, tcgplayer: null };
        for (const reference of referencesByLot.get(lot.id) ?? []) {
          const provider = providerById.get(reference.provider_id);
          const market = provider ? providerMarket(provider.slug) : null;
          if (!market) continue;
          quoteAtAdd[market] = market === 'cardmarket'
            ? numberOrNull(reference.trend_value) ?? numberOrNull(reference.market_value)
            : numberOrNull(reference.market_value);
        }
        return {
          id: `lot-${lot.id}`,
          addedAt: lot.captured_at,
          quantity: lot.added_quantity,
          quoteAtAdd,
          purchasePrice: numberOrNull(lot.purchase_unit_amount) ?? undefined,
          purchaseCurrency: lot.purchase_currency ?? undefined,
        };
      });

      return [{
        ...displayAsset,
        id: `holding-${item.id}`,
        collectionItemId: item.id,
        catalogId: sourceAssetId ?? displayAsset.catalogId,
        condition: conditionFromDatabase(item.condition),
        quantity: item.quantity,
        purchasePrice: numberOrNull(item.purchase_unit_amount) ?? undefined,
        purchaseCurrency: item.purchase_currency ?? undefined,
        note: item.private_note ?? undefined,
        addedAt: item.created_at,
        acquisitionLots,
      }];
    });

    const dailySnapshots = dailyRows.flatMap((row): PortfolioDailySnapshotV2[] => {
      const provider = providerById.get(row.provider_id);
      const market = provider ? providerMarket(provider.slug) : null;
      if (!market) return [];
      return [{
        provider: market,
        date: row.snapshot_date,
        currency: row.currency,
        marketValue: numberOrNull(row.market_value),
        acquisitionValue: numberOrNull(row.acquisition_value),
        absoluteGrowth: numberOrNull(row.absolute_growth),
        growthPercentage: numberOrNull(row.growth_percentage),
        itemCount: row.item_count,
        unitCount: row.unit_count,
        pricedUnitCount: row.priced_unit_count,
        unpricedUnitCount: row.unpriced_unit_count,
        acquisitionPricedUnitCount: row.acquisition_priced_unit_count,
        acquisitionUnpricedUnitCount: row.acquisition_unpriced_unit_count,
        sourceObservedAt: row.latest_price_observed_at,
        generatedAt: row.updated_at,
      }];
    });

    return { assets, dailySnapshots, unmappedHoldingCount };
  }

  async add(input: AddCollectionItemV2, expectedOwnerId: string): Promise<void> {
    if (!expectedOwnerId) throw new Error('A signed-in collection owner is required.');
    const target = await this.resolveCatalogTarget(input.asset);
    const { error } = await this.client.rpc('add_or_merge_collection_item_v2', {
      p_expected_owner_id: expectedOwnerId,
      p_card_variant_id: target.cardVariantId,
      p_sealed_product_id: target.sealedProductId,
      p_condition: conditionToDatabase(input.condition),
      p_quantity: input.quantity,
      p_private_note: input.privateNote?.trim() || null,
      p_purchase_unit_amount: input.purchaseUnitAmount ?? null,
      p_purchase_currency: input.purchaseUnitAmount === undefined
        ? null
        : input.purchaseCurrency ?? (input.asset.quote.cardmarket !== null ? 'EUR' : 'USD'),
    });
    if (error) throw new Error(`Add collection item: ${error.message}`);
  }

  async setQuantity(collectionItemId: string, quantity: number): Promise<void> {
    const { error } = await this.client.rpc('set_collection_item_quantity', {
      p_collection_item_id: collectionItemId,
      p_quantity: quantity,
    });
    if (error) throw new Error(`Update collection quantity: ${error.message}`);
  }

  async updateNote(collectionItemId: string, privateNote?: string): Promise<void> {
    const { error } = await this.client.rpc('update_collection_item_details', {
      p_collection_item_id: collectionItemId,
      p_private_note: privateNote?.trim() || null,
    });
    if (error) throw new Error(`Update collection item: ${error.message}`);
  }

  async remove(collectionItemId: string): Promise<void> {
    const { error } = await this.client.rpc('soft_remove_collection_item', {
      p_collection_item_id: collectionItemId,
    });
    if (error) throw new Error(`Remove collection item: ${error.message}`);
  }

  private async resolveCatalogTarget(asset: DemoAsset): Promise<{
    cardVariantId: string | null;
    sealedProductId: string | null;
  }> {
    const sourceAssetId = asset.catalogId ?? asset.id;
    const table = asset.kind === 'card' ? 'card_variants' : 'sealed_products';
    const { data, error } = await this.client
      .from(table)
      .select('id')
      .contains('external_identifiers', { tcg_harbor_asset_id: sourceAssetId })
      .is('archived_at', null)
      .limit(2);
    if (error) throw new Error(`Resolve catalog item: ${error.message}`);
    if (!data || data.length !== 1) {
      throw new Error(data?.length
        ? 'This catalog printing is ambiguous and must be reviewed before it can be added.'
        : 'This catalog printing has not reached the account database yet. Try again after the next catalog sync.');
    }
    return asset.kind === 'card'
      ? { cardVariantId: String(data[0].id), sealedProductId: null }
      : { cardVariantId: null, sealedProductId: String(data[0].id) };
  }
}
