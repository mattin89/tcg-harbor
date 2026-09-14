import type { DemoAsset } from '../data/demo';

export interface AdminCatalogOverride {
  readonly id: string;
  readonly name?: string;
  readonly productName?: string;
  readonly set?: string;
  readonly setCode?: string;
  readonly number?: string;
  readonly rulesCardId?: string;
  readonly rarity?: string;
  readonly variant?: string;
  readonly productType?: string;
  readonly language?: string;
  readonly condition?: string;
  readonly imageUrl?: string;
  readonly imageState?: 'available' | 'unavailable';
  readonly cardmarketProductId?: number | null;
  readonly cardmarketExpansionId?: number | null;
  readonly cardmarketPriceState?: 'available' | 'trend-unavailable' | 'ambiguous-artwork' | 'unmapped' | 'not-listed';
  readonly cardmarketPriceReason?: string;
  readonly cardmarketTrendPrice?: number | null;
  readonly tcgplayerProductId?: number | null;
  readonly tcgplayerGroupId?: number | null;
  readonly tcgplayerPriceState?: 'available' | 'unavailable';
  readonly tcgplayerMarketPrice?: number | null;
  readonly errorResolved?: boolean;
  readonly adminNote?: string;
  readonly updatedAt: string;
}

export type CatalogItemIssue =
  | 'unmapped-cardmarket'
  | 'ambiguous-artwork'
  | 'missing-image'
  | 'trend-unavailable'
  | 'price-unavailable'
  | 'continuity-flagged';

export interface CatalogItemDiagnostics {
  readonly issues: readonly CatalogItemIssue[];
  readonly isFlaggedOrError: boolean;
}

const STORAGE_KEY = 'tcg-harbor-admin-catalog-overrides-v1';
export const CATALOG_UPDATED_EVENT = 'tcg-harbor:catalog-updated';

let memoryStorage: Record<string, string> = {};

function getRawStorageItem(key: string): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memoryStorage[key] ?? null;
    }
  }
  return memoryStorage[key] ?? null;
}

function setRawStorageItem(key: string, value: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota or security error protection
    }
  }
  memoryStorage[key] = value;
}

function removeRawStorageItem(key: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Protection
    }
  }
  delete memoryStorage[key];
}

/**
 * Retrieve all persisted catalog overrides from local storage.
 */
export function getAdminCatalogOverrides(): Record<string, AdminCatalogOverride> {
  try {
    const raw = getRawStorageItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, AdminCatalogOverride>;
  } catch {
    return {};
  }
}

/**
 * Persist or update an administrative override for an individual card or sealed product.
 */
export function saveAdminCatalogOverride(override: AdminCatalogOverride): void {
  const current = getAdminCatalogOverrides();
  current[override.id] = {
    ...override,
    updatedAt: override.updatedAt || new Date().toISOString(),
  };

  setRawStorageItem(STORAGE_KEY, JSON.stringify(current));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT, { detail: { override } }));
  }
}

/**
 * Remove an override for a specific catalog asset, restoring its baseline configuration.
 */
export function resetAdminCatalogOverride(id: string): void {
  const current = getAdminCatalogOverrides();
  if (!(id in current)) return;

  delete current[id];
  setRawStorageItem(STORAGE_KEY, JSON.stringify(current));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT, { detail: { resetId: id } }));
  }
}

/**
 * Clear all overrides back to fresh baseline.
 */
export function clearAllAdminCatalogOverrides(): void {
  removeRawStorageItem(STORAGE_KEY);
  memoryStorage = {};

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT, { detail: { cleared: true } }));
  }
}

/**
 * Merge saved admin overrides over the base catalog assets.
 */
export function applyCatalogOverrides(
  assets: readonly DemoAsset[],
  overrides: Record<string, AdminCatalogOverride> = getAdminCatalogOverrides(),
): DemoAsset[] {
  if (!overrides || Object.keys(overrides).length === 0) {
    return [...assets];
  }

  return assets.map((asset) => {
    const override = overrides[asset.id];
    if (!override) return asset;

    const nextQuote = { ...asset.quote };
    if (override.cardmarketTrendPrice !== undefined) {
      nextQuote.cardmarket = override.cardmarketTrendPrice;
    }
    if (override.tcgplayerMarketPrice !== undefined) {
      nextQuote.tcgplayer = override.tcgplayerMarketPrice;
    }

    const nextPricing = {
      cardmarket: {
        trend: null,
        low: null,
        average: null,
        average1Day: null,
        average7Days: null,
        average30Days: null,
        ...(asset.pricing?.cardmarket ?? {}),
      },
      usMarket: {
        market: null,
        inventory: null,
        ...(asset.pricing?.usMarket ?? {}),
      },
    };
    if (override.cardmarketTrendPrice !== undefined) {
      nextPricing.cardmarket.trend = override.cardmarketTrendPrice;
    }
    if (override.tcgplayerMarketPrice !== undefined) {
      nextPricing.usMarket.market = override.tcgplayerMarketPrice;
    }

    // When admin marks error as resolved, clear error states
    const resolvedCardmarketState = override.errorResolved && (!override.cardmarketPriceState || override.cardmarketPriceState === 'unmapped')
      ? 'available'
      : (override.cardmarketPriceState ?? asset.cardmarketPriceState);

    const resolvedImageState = override.errorResolved && (!override.imageState || override.imageState === 'unavailable')
      ? 'available'
      : (override.imageState ?? asset.imageState);

    return {
      ...asset,
      name: override.name ?? asset.name,
      productName: override.productName ?? asset.productName,
      set: override.set ?? asset.set,
      setCode: override.setCode ?? asset.setCode,
      number: override.number ?? asset.number,
      rulesCardId: override.rulesCardId ?? asset.rulesCardId,
      rarity: override.rarity ?? asset.rarity,
      variant: override.variant ?? asset.variant,
      productType: override.productType ?? asset.productType,
      language: override.language ?? asset.language,
      condition: override.condition ?? asset.condition,
      imageUrl: override.imageUrl ?? asset.imageUrl,
      imageState: resolvedImageState,
      cardmarketProductId: override.cardmarketProductId !== undefined ? (override.cardmarketProductId ?? undefined) : asset.cardmarketProductId,
      cardmarketExpansionId: override.cardmarketExpansionId !== undefined ? (override.cardmarketExpansionId ?? undefined) : asset.cardmarketExpansionId,
      cardmarketPriceState: resolvedCardmarketState,
      cardmarketPriceReason: override.cardmarketPriceReason ?? asset.cardmarketPriceReason,
      tcgplayerProductId: override.tcgplayerProductId !== undefined ? (override.tcgplayerProductId ?? undefined) : asset.tcgplayerProductId,
      tcgplayerGroupId: override.tcgplayerGroupId !== undefined ? (override.tcgplayerGroupId ?? undefined) : asset.tcgplayerGroupId,
      tcgplayerPriceState: override.tcgplayerPriceState ?? asset.tcgplayerPriceState,
      quote: nextQuote,
      pricing: nextPricing,
      note: override.adminNote ? (asset.note ? `${asset.note} | Admin: ${override.adminNote}` : `Admin: ${override.adminNote}`) : asset.note,
    };
  });
}

/**
 * Diagnostic helper that flags items with missing imagery, unmapped cardmarket mappings, or unpriced references.
 */
export function diagnoseCatalogItem(
  asset: DemoAsset,
  flaggedAssetIds?: ReadonlySet<string>,
): CatalogItemDiagnostics {
  const issues: CatalogItemIssue[] = [];

  if (asset.cardmarketPriceState === 'unmapped') {
    issues.push('unmapped-cardmarket');
  } else if (asset.cardmarketPriceState === 'ambiguous-artwork') {
    issues.push('ambiguous-artwork');
  } else if (asset.cardmarketPriceState === 'trend-unavailable') {
    issues.push('trend-unavailable');
  }

  if (asset.imageState === 'unavailable' || !asset.imageUrl) {
    issues.push('missing-image');
  }

  if (asset.tcgplayerPriceState === 'unavailable' && asset.quote.tcgplayer === null) {
    issues.push('price-unavailable');
  }

  if (flaggedAssetIds?.has(asset.id)) {
    issues.push('continuity-flagged');
  }

  return {
    issues,
    isFlaggedOrError: issues.length > 0,
  };
}

/**
 * Export all overrides as formatted JSON string for upstream ingestion.
 */
export function exportCatalogOverridesJson(): string {
  const overrides = getAdminCatalogOverrides();
  return JSON.stringify(overrides, null, 2);
}

/**
 * Import overrides from JSON string into local storage.
 */
export function importCatalogOverridesJson(jsonText: string): { imported: number; error: string | null } {
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') {
      return { imported: 0, error: 'Input must be a valid JSON object of catalog overrides.' };
    }

    const current = getAdminCatalogOverrides();
    let count = 0;

    for (const [id, value] of Object.entries(parsed)) {
      if (value && typeof value === 'object') {
        current[id] = { ...(value as AdminCatalogOverride), id };
        count++;
      }
    }

    setRawStorageItem(STORAGE_KEY, JSON.stringify(current));

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT, { detail: { imported: count } }));
    }

    return { imported: count, error: null };
  } catch (err) {
    return { imported: 0, error: err instanceof Error ? err.message : 'Failed to parse overrides JSON.' };
  }
}
