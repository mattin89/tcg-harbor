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
  readonly isApproved?: boolean;
  readonly approvedAt?: string;
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
const STORAGE_KEY_APPROVED = 'tcg-harbor-admin-approved-assets-v1';
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
 * Retrieve the set of administrative approved asset IDs.
 */
export function getAdminApprovedAssetIds(): Set<string> {
  try {
    const raw = getRawStorageItem(STORAGE_KEY_APPROVED);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((id): id is string => typeof id === 'string'));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

/**
 * Persist the full set of approved asset IDs to storage.
 */
export function saveAdminApprovedAssetIds(ids: ReadonlySet<string>): void {
  const array = Array.from(ids);
  setRawStorageItem(STORAGE_KEY_APPROVED, JSON.stringify(array));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT, { detail: { approvedCount: array.length } }));
  }
}

/**
 * Approve an individual asset ID.
 */
export function approveCatalogAsset(id: string): void {
  const current = getAdminApprovedAssetIds();
  current.add(id);
  saveAdminApprovedAssetIds(current);

  const overrides = getAdminCatalogOverrides();
  if (overrides[id]?.isApproved === false) {
    saveAdminCatalogOverride({
      ...overrides[id],
      isApproved: true,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Revoke approval for an individual asset ID.
 */
export function revokeCatalogAssetApproval(id: string): void {
  const current = getAdminApprovedAssetIds();
  current.delete(id);
  saveAdminApprovedAssetIds(current);

  const overrides = getAdminCatalogOverrides();
  saveAdminCatalogOverride({
    ...(overrides[id] ?? { id }),
    isApproved: false,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Bulk approve all items in the catalog that pass diagnostics without error or flags.
 */
export function approveAllVerifiedItems(
  assets: readonly DemoAsset[],
  flaggedAssetIds?: ReadonlySet<string>,
): { approvedCount: number; totalVerified: number } {
  const current = getAdminApprovedAssetIds();
  const overrides = getAdminCatalogOverrides();
  let newlyApproved = 0;
  let totalVerified = 0;

  for (const asset of assets) {
    const diag = diagnoseCatalogItem(asset, flaggedAssetIds);
    if (!diag.isFlaggedOrError) {
      totalVerified++;
      if (!current.has(asset.id)) {
        current.add(asset.id);
        newlyApproved++;
      }
      if (overrides[asset.id]?.isApproved === false) {
        saveAdminCatalogOverride({
          ...overrides[asset.id],
          isApproved: true,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  saveAdminApprovedAssetIds(current);
  return { approvedCount: newlyApproved, totalVerified };
}

/**
 * Check whether a catalog asset has been approved.
 */
export function isCatalogAssetApproved(
  asset: DemoAsset,
  overrides: Record<string, AdminCatalogOverride> = getAdminCatalogOverrides(),
  approvedIds: ReadonlySet<string> = getAdminApprovedAssetIds(),
): boolean {
  const override = overrides[asset.id];
  if (override?.isApproved !== undefined) {
    return override.isApproved;
  }
  return approvedIds.has(asset.id) || Boolean(asset.isApproved);
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
 * Clear all overrides and approvals back to fresh baseline.
 */
export function clearAllAdminCatalogOverrides(): void {
  removeRawStorageItem(STORAGE_KEY);
  removeRawStorageItem(STORAGE_KEY_APPROVED);
  memoryStorage = {};

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT, { detail: { cleared: true } }));
  }
}

/**
 * Merge saved admin overrides and approvals over the base catalog assets.
 */
export function applyCatalogOverrides(
  assets: readonly DemoAsset[],
  overrides: Record<string, AdminCatalogOverride> = getAdminCatalogOverrides(),
  approvedIds: ReadonlySet<string> = getAdminApprovedAssetIds(),
): DemoAsset[] {
  return assets.map((asset) => {
    const override = overrides[asset.id];
    const isApproved = override?.isApproved !== undefined
      ? override.isApproved
      : (approvedIds.has(asset.id) || Boolean(asset.isApproved));
    const approvedAt = override?.approvedAt ?? (isApproved ? (asset.approvedAt || override?.updatedAt || '2026-09-21T00:00:00.000Z') : undefined);

    if (!override) {
      if (isApproved !== asset.isApproved || approvedAt !== asset.approvedAt) {
        return {
          ...asset,
          isApproved,
          approvedAt,
        };
      }
      return asset;
    }

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
      isApproved,
      approvedAt,
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
 * Export all overrides and approved IDs as formatted JSON string for upstream ingestion.
 */
export function exportCatalogOverridesJson(): string {
  const overrides = getAdminCatalogOverrides();
  const approvedIds = Array.from(getAdminApprovedAssetIds());
  return JSON.stringify({ overrides, approvedIds }, null, 2);
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

    let overridesObj: Record<string, unknown> = {};
    let approvedArr: unknown[] = [];

    if (parsed.overrides && typeof parsed.overrides === 'object') {
      overridesObj = parsed.overrides as Record<string, unknown>;
      if (Array.isArray(parsed.approvedIds)) {
        approvedArr = parsed.approvedIds;
      }
    } else {
      overridesObj = parsed as Record<string, unknown>;
    }

    for (const [id, value] of Object.entries(overridesObj)) {
      if (value && typeof value === 'object') {
        current[id] = { ...(value as AdminCatalogOverride), id };
        count++;
      }
    }

    setRawStorageItem(STORAGE_KEY, JSON.stringify(current));

    if (approvedArr.length > 0) {
      const currentApproved = getAdminApprovedAssetIds();
      for (const item of approvedArr) {
        if (typeof item === 'string') currentApproved.add(item);
      }
      setRawStorageItem(STORAGE_KEY_APPROVED, JSON.stringify(Array.from(currentApproved)));
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CATALOG_UPDATED_EVENT, { detail: { imported: count } }));
    }

    return { imported: count, error: null };
  } catch (err) {
    return { imported: 0, error: err instanceof Error ? err.message : 'Failed to parse overrides JSON.' };
  }
}
