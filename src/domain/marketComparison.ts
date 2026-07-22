import type { DemoAsset } from '../data/demo';

export const MARKET_COMPARISON_LIMIT = 20;
export const VERIFIED_TCGPLAYER_PRICE_SOURCE = 'TCGplayer via TCGCSV' as const;

export type MarketComparisonPriceBound = number | string | null | undefined;

export interface MarketComparisonFilters {
  readonly minCardmarketEur?: MarketComparisonPriceBound;
  readonly maxCardmarketEur?: MarketComparisonPriceBound;
}

export type MarketComparisonPriceFilterError =
  | 'invalid-minimum'
  | 'invalid-maximum'
  | 'minimum-exceeds-maximum';

export interface SanitizedMarketComparisonPriceFilter {
  readonly minCardmarketEur: number | null;
  readonly maxCardmarketEur: number | null;
  readonly error: MarketComparisonPriceFilterError | null;
}

export const MARKET_COMPARISON_EXCLUSION_REASONS = [
  'not-card',
  'missing-printing-id',
  'missing-cardmarket-product-id',
  'unverified-tcgplayer-source',
  'missing-tcgplayer-product-id',
  'invalid-cardmarket-price',
  'invalid-tcgplayer-price',
  'invalid-derived-ratio',
  'duplicate-printing-identity',
] as const;

export type MarketComparisonExclusionReason =
  (typeof MARKET_COMPARISON_EXCLUSION_REASONS)[number];

export interface MarketComparisonRow {
  readonly assetId: string;
  readonly catalogId?: string;
  readonly printingId: string;
  readonly rulesCardId?: string;
  readonly name: string;
  readonly number?: string;
  readonly set: string;
  readonly setCode: string;
  readonly rarity: string;
  readonly variant: string;
  readonly language: string;
  readonly imageUrl?: string;
  readonly cardmarketProductId: number;
  readonly tcgplayerProductId: number;
  readonly cardmarketEur: number;
  readonly cardmarketUsd: number;
  readonly tcgplayerUsd: number;
  /** TCGplayer USD market price divided by Cardmarket EUR trend converted to USD. */
  readonly ratio: number;
  readonly usPriceSource: typeof VERIFIED_TCGPLAYER_PRICE_SOURCE;
}

export interface MarketComparisonSummary {
  readonly inputAssetCount: number;
  readonly cardAssetCount: number;
  /** Exact price pairs available before the optional Cardmarket price range. */
  readonly eligiblePrintingCount: number;
  /** Exact price pairs inside the inclusive Cardmarket price range. */
  readonly filteredEligiblePrintingCount: number;
  readonly excludedAssetCount: number;
  readonly excludedCardPrintingCount: number;
  /** Reasons are mutually exclusive, so their counts sum to excludedAssetCount. */
  readonly exclusionCounts: Readonly<Record<MarketComparisonExclusionReason, number>>;
}

export interface MarketComparisonResult {
  readonly eurToUsdRate: number;
  readonly limit: typeof MARKET_COMPARISON_LIMIT;
  readonly priceFilter: SanitizedMarketComparisonPriceFilter;
  readonly highest: readonly MarketComparisonRow[];
  readonly lowest: readonly MarketComparisonRow[];
  readonly summary: MarketComparisonSummary;
}

function createExclusionCounts(): Record<MarketComparisonExclusionReason, number> {
  return {
    'not-card': 0,
    'missing-printing-id': 0,
    'missing-cardmarket-product-id': 0,
    'unverified-tcgplayer-source': 0,
    'missing-tcgplayer-product-id': 0,
    'invalid-cardmarket-price': 0,
    'invalid-tcgplayer-price': 0,
    'invalid-derived-ratio': 0,
    'duplicate-printing-identity': 0,
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sanitizePriceBound(value: MarketComparisonPriceBound): {
  readonly value: number | null;
  readonly invalid: boolean;
} {
  if (value === undefined || value === null) {
    return { value: null, invalid: false };
  }

  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { value: null, invalid: false };
    }

    // Accept either decimal separator for user-entered EUR values, but reject
    // ambiguous formats such as thousands separators or currency symbols.
    if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(trimmed)) {
      return { value: null, invalid: true };
    }
    parsed = Number(trimmed.replace(',', '.'));
  }

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, invalid: true };
  }

  return { value: parsed, invalid: false };
}

/**
 * Converts optional UI-friendly price bounds into safe numeric EUR values.
 * Empty values mean no bound. Invalid values and inverted ranges are reported
 * in the result so callers can present an accessible correction instead of
 * silently changing the user's intended range.
 */
export function sanitizeMarketComparisonPriceFilter(
  filters: MarketComparisonFilters = {},
): SanitizedMarketComparisonPriceFilter {
  const minimum = sanitizePriceBound(filters.minCardmarketEur);
  const maximum = sanitizePriceBound(filters.maxCardmarketEur);

  const error: MarketComparisonPriceFilterError | null = minimum.invalid
    ? 'invalid-minimum'
    : maximum.invalid
      ? 'invalid-maximum'
      : minimum.value !== null && maximum.value !== null && minimum.value > maximum.value
        ? 'minimum-exceeds-maximum'
        : null;

  return {
    minCardmarketEur: minimum.value,
    maxCardmarketEur: maximum.value,
    error,
  };
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareIdentity(left: MarketComparisonRow, right: MarketComparisonRow): number {
  return compareText(left.printingId, right.printingId)
    || compareText(left.assetId, right.assetId);
}

function compareLowestFirst(left: MarketComparisonRow, right: MarketComparisonRow): number {
  if (left.ratio < right.ratio) return -1;
  if (left.ratio > right.ratio) return 1;
  return compareIdentity(left, right);
}

function compareHighestFirst(left: MarketComparisonRow, right: MarketComparisonRow): number {
  if (left.ratio > right.ratio) return -1;
  if (left.ratio < right.ratio) return 1;
  return compareIdentity(left, right);
}

interface MarketComparisonCandidate {
  readonly row: MarketComparisonRow;
  /** Stable catalog identity shared by a canonical asset and any hidden aliases. */
  readonly stableAssetId: string;
  readonly isCatalogAlias: boolean;
  readonly isArchived: boolean;
}

function usableIdentity(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function providerPairIdentity(row: MarketComparisonRow): string {
  return `${row.cardmarketProductId}:${row.tcgplayerProductId}`;
}

function compareCandidateRepresentative(
  left: MarketComparisonCandidate,
  right: MarketComparisonCandidate,
): number {
  // Prefer the visible, current catalog row. The remaining lexical fallbacks
  // make the result independent of source-array order when two visible rows
  // accidentally carry the same exact provider pair.
  if (left.isCatalogAlias !== right.isCatalogAlias) return left.isCatalogAlias ? 1 : -1;
  if (left.isArchived !== right.isArchived) return left.isArchived ? 1 : -1;
  return compareText(left.stableAssetId, right.stableAssetId)
    || compareIdentity(left.row, right.row);
}

/**
 * Collapses historical catalog aliases and repeated Cardmarket/TCGplayer pairs.
 * The two identities are joined transitively so an alias cannot reintroduce a
 * provider pair under a different asset ID. Printings which merely share a card
 * number are intentionally untouched: alternate, manga, SP, and promotional
 * arts have their own provider pairs and remain independently comparable.
 */
function deduplicateCandidates(
  candidates: readonly MarketComparisonCandidate[],
): {
  readonly rows: MarketComparisonRow[];
  readonly duplicateCount: number;
} {
  const parents = candidates.map((_, index) => index);

  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };

  const unite = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  const indexByStableAssetId = new Map<string, number>();
  const indexByProviderPair = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    const stableMatch = indexByStableAssetId.get(candidate.stableAssetId);
    if (stableMatch === undefined) indexByStableAssetId.set(candidate.stableAssetId, index);
    else unite(index, stableMatch);

    const providerPair = providerPairIdentity(candidate.row);
    const providerMatch = indexByProviderPair.get(providerPair);
    if (providerMatch === undefined) indexByProviderPair.set(providerPair, index);
    else unite(index, providerMatch);
  });

  const groups = new Map<number, MarketComparisonCandidate[]>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(candidate);
    else groups.set(root, [candidate]);
  });

  const rows: MarketComparisonRow[] = [];
  let duplicateCount = 0;
  for (const group of groups.values()) {
    const representative = group.slice().sort(compareCandidateRepresentative)[0];
    rows.push(representative.row);
    duplicateCount += group.length - 1;
  }

  return { rows, duplicateCount };
}

/**
 * Compares exact card printings only when both provider identities and prices are
 * independently evidenced. In particular, an OPTCG API USD quote is not treated
 * as a genuine TCGplayer quote; TCGCSV provenance plus a TCGplayer product ID are
 * both required.
 */
export function compareCardMarkets(
  assets: readonly DemoAsset[],
  eurToUsdRate: number,
  filters: MarketComparisonFilters = {},
): MarketComparisonResult {
  if (!isPositiveFiniteNumber(eurToUsdRate)) {
    throw new RangeError('EUR to USD rate must be a finite number greater than zero.');
  }

  const candidates: MarketComparisonCandidate[] = [];
  const exclusionCounts = createExclusionCounts();
  let cardAssetCount = 0;

  const exclude = (reason: MarketComparisonExclusionReason) => {
    exclusionCounts[reason] += 1;
  };

  for (const asset of assets) {
    if (asset.kind !== 'card') {
      exclude('not-card');
      continue;
    }

    cardAssetCount += 1;

    if (typeof asset.printingId !== 'string' || asset.printingId.trim().length === 0) {
      exclude('missing-printing-id');
      continue;
    }

    if (!isPositiveInteger(asset.cardmarketProductId)) {
      exclude('missing-cardmarket-product-id');
      continue;
    }

    if (asset.usPriceSource !== VERIFIED_TCGPLAYER_PRICE_SOURCE) {
      exclude('unverified-tcgplayer-source');
      continue;
    }

    if (!isPositiveInteger(asset.tcgplayerProductId)) {
      exclude('missing-tcgplayer-product-id');
      continue;
    }

    const cardmarketEur = asset.quote.cardmarket;
    if (!isPositiveFiniteNumber(cardmarketEur)) {
      exclude('invalid-cardmarket-price');
      continue;
    }

    const tcgplayerUsd = asset.quote.tcgplayer;
    if (!isPositiveFiniteNumber(tcgplayerUsd)) {
      exclude('invalid-tcgplayer-price');
      continue;
    }

    const cardmarketUsd = cardmarketEur * eurToUsdRate;
    const ratio = tcgplayerUsd / cardmarketUsd;
    if (!isPositiveFiniteNumber(cardmarketUsd) || !isPositiveFiniteNumber(ratio)) {
      exclude('invalid-derived-ratio');
      continue;
    }

    const row: MarketComparisonRow = {
      assetId: asset.id,
      catalogId: asset.catalogId,
      printingId: asset.printingId,
      rulesCardId: asset.rulesCardId,
      name: asset.name,
      number: asset.number,
      set: asset.set,
      setCode: asset.setCode,
      rarity: asset.rarity,
      variant: asset.variant,
      language: asset.language,
      imageUrl: asset.imageUrl,
      cardmarketProductId: asset.cardmarketProductId,
      tcgplayerProductId: asset.tcgplayerProductId,
      cardmarketEur,
      cardmarketUsd,
      tcgplayerUsd,
      ratio,
      usPriceSource: VERIFIED_TCGPLAYER_PRICE_SOURCE,
    };
    candidates.push({
      row,
      stableAssetId: usableIdentity(asset.catalogAliasOf)
        ?? usableIdentity(asset.catalogId)
        ?? asset.id,
      isCatalogAlias: usableIdentity(asset.catalogAliasOf) !== null,
      isArchived: asset.catalogArchived === true,
    });
  }

  const { rows, duplicateCount } = deduplicateCandidates(candidates);
  exclusionCounts['duplicate-printing-identity'] = duplicateCount;

  const priceFilter = sanitizeMarketComparisonPriceFilter(filters);
  // Apply the inclusive Cardmarket range to the complete exact-printing pool.
  // Only then derive each top/bottom ranking, so changing either bound refills
  // both lists instead of filtering a previously truncated set of 20.
  const filteredRows = priceFilter.error === null
    ? rows.filter((row) => (
      (priceFilter.minCardmarketEur === null || row.cardmarketEur >= priceFilter.minCardmarketEur)
      && (priceFilter.maxCardmarketEur === null || row.cardmarketEur <= priceFilter.maxCardmarketEur)
    ))
    : [];

  const highest = filteredRows
    .slice()
    .sort(compareHighestFirst)
    .slice(0, MARKET_COMPARISON_LIMIT);
  const lowest = filteredRows
    .slice()
    .sort(compareLowestFirst)
    .slice(0, MARKET_COMPARISON_LIMIT);

  return {
    eurToUsdRate,
    limit: MARKET_COMPARISON_LIMIT,
    priceFilter,
    highest,
    lowest,
    summary: {
      inputAssetCount: assets.length,
      cardAssetCount,
      eligiblePrintingCount: rows.length,
      filteredEligiblePrintingCount: filteredRows.length,
      excludedAssetCount: assets.length - rows.length,
      excludedCardPrintingCount: cardAssetCount - rows.length,
      exclusionCounts,
    },
  };
}
