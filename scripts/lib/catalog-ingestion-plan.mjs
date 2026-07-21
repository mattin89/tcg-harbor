export const PRODUCT_LEVEL_PRICE_SCOPE = 'product_level_not_condition_adjusted';

export function officialProductCodeFromTitle(title) {
  return String(title ?? '').match(/[\[【]((?:OP|EB|PRB|ST)-?\d{2}(?:-EB\d{2})?)[\]】]/i)?.[1]?.toUpperCase() ?? null;
}

export function officialMemberSetCodesFromLabel(label) {
  return [...String(label ?? '').toUpperCase().matchAll(/(?:OP|EB|PRB|ST)-?\d{2}/g)]
    .map((match) => match[0].replace('-', ''));
}

export function catalogSetCodeIsReleased(setCode, releasedSetCodes) {
  const members = officialMemberSetCodesFromLabel(setCode);
  return members.length === 0 || members.every((member) => releasedSetCodes.has(member));
}

export function officialSetCodeReleaseState(setCode, releasedSetCodes, futureSetCodes) {
  const members = officialMemberSetCodesFromLabel(setCode);
  if (members.length === 0) return 'unmanaged';
  if (members.every((member) => releasedSetCodes.has(member))) return 'released';
  if (members.some((member) => !releasedSetCodes.has(member) && !futureSetCodes.has(member))) {
    return 'unknown';
  }
  return 'future';
}

export function assertSnapshotCanAdvanceProviders(snapshotGeneratedAt, providers) {
  const snapshotTime = Date.parse(snapshotGeneratedAt);
  if (!Number.isFinite(snapshotTime)) {
    throw new Error(`Catalog snapshot has an invalid generatedAt value: ${snapshotGeneratedAt}.`);
  }
  const newerProvider = providers.find((provider) => (
    provider.last_sync_at != null && Date.parse(provider.last_sync_at) > snapshotTime
  ));
  if (newerProvider) {
    throw new Error(
      `Catalog snapshot ${snapshotGeneratedAt} is older than ${newerProvider.slug} state ${newerProvider.last_sync_at}.`,
    );
  }
}

export function pricingConditionForAsset(kind) {
  if (kind === 'card') return 'near_mint';
  if (kind === 'sealed') return 'sealed';
  throw new Error(`Unsupported catalog asset kind: ${kind}`);
}

export function providerMappingStableSeed(providerSlug, assetId, condition) {
  return `${providerSlug}:${assetId}:${condition}`;
}

export function productLevelMappingMetadata({ assetId, source, syncRunId, syncGeneratedAt }) {
  return {
    tcg_harbor_asset_id: assetId,
    source,
    price_scope: PRODUCT_LEVEL_PRICE_SCOPE,
    condition_adjusted: false,
    condition_value_policy: 'single_verified_product_reference_with_condition_agnostic_valuation_fallback',
    catalog_sync_run_id: syncRunId,
    catalog_sync_generated_at: syncGeneratedAt,
    tcg_harbor_game_slug: 'one-piece-card-game',
  };
}

export function activeManagedRowsMissingFromPlan(
  existingRows,
  plannedIds,
  { inactiveField, managedAssetId },
) {
  const desired = plannedIds instanceof Set ? plannedIds : new Set(plannedIds);
  return existingRows
    .filter((row) => row[inactiveField] == null && managedAssetId(row) && !desired.has(row.id))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

export function assertManagedCatalogContinuity(
  previousAssets,
  nextAssets,
  approvedRemovalIds = new Set(),
) {
  const nextById = new Map(nextAssets.map((asset) => [asset.id, asset]));
  const unapprovedRemovals = previousAssets.filter((asset) => (
    !nextById.has(asset.id) && !approvedRemovalIds.has(asset.id)
  ));
  if (unapprovedRemovals.length > 0) {
    const samples = unapprovedRemovals.slice(0, 20).map((asset) => `${asset.id} (${asset.setCode ?? 'unknown set'})`);
    throw new Error(
      `Catalog continuity check rejected ${unapprovedRemovals.length} unapproved asset removals: ${samples.join(', ')}.`,
    );
  }

  const kindChanges = previousAssets.filter((asset) => {
    const next = nextById.get(asset.id);
    return next && next.kind !== asset.kind;
  });
  if (kindChanges.length > 0) {
    throw new Error(`Catalog continuity check rejected ${kindChanges.length} stable IDs whose asset kind changed.`);
  }

  return previousAssets.filter((asset) => !nextById.has(asset.id));
}

export function activeCatalogRemovalApprovalIds(approvals, snapshotGeneratedAt) {
  const snapshotTime = Date.parse(snapshotGeneratedAt);
  if (!Number.isFinite(snapshotTime)) throw new Error('Catalog removal approvals require a valid snapshot timestamp.');
  return new Set([...approvals.entries()]
    .filter(([, approval]) => {
      const expiresAt = Date.parse(approval.expiresAt);
      if (!Number.isFinite(expiresAt)) throw new Error('Catalog removal approval has an invalid expiry.');
      return snapshotTime < expiresAt;
    })
    .map(([assetId]) => assetId));
}
