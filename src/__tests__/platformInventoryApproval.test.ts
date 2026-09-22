import { beforeEach, describe, expect, it } from 'vitest';
import { catalogAssets } from '../data/demo';
import {
  applyCatalogOverrides,
  approveAllVerifiedItems,
  approveCatalogAsset,
  clearAllAdminCatalogOverrides,
  diagnoseCatalogItem,
  getAdminApprovedAssetIds,
  isCatalogAssetApproved,
  revokeCatalogAssetApproval,
} from '../services/adminCatalogStore';

describe('platform inventory approval mechanics', () => {
  beforeEach(() => {
    clearAllAdminCatalogOverrides();
  });

  it('correctly audits catalog assets and bulk approves all verified cards', () => {
    let verifiedCount = 0;
    let flaggedCount = 0;

    for (const asset of catalogAssets) {
      const diag = diagnoseCatalogItem(asset);
      if (diag.isFlaggedOrError) {
        flaggedCount++;
      } else {
        verifiedCount++;
      }
    }

    expect(verifiedCount).toBeGreaterThan(3000);
    expect(flaggedCount).toBeGreaterThan(0);

    expect(getAdminApprovedAssetIds().size).toBe(0);

    const res = approveAllVerifiedItems(catalogAssets);
    expect(res.totalVerified).toBe(verifiedCount);
    expect(res.approvedCount).toBe(verifiedCount);

    const approvedSet = getAdminApprovedAssetIds();
    expect(approvedSet.size).toBe(verifiedCount);

    const applied = applyCatalogOverrides(catalogAssets.slice(0, 50));
    for (const asset of applied) {
      const diag = diagnoseCatalogItem(asset);
      if (!diag.isFlaggedOrError) {
        expect(asset.isApproved).toBe(true);
        expect(asset.approvedAt).toBeDefined();
      } else {
        expect(asset.isApproved).toBeFalsy();
      }
    }
  });

  it('supports single card approval and revocation', () => {
    const verified = catalogAssets.find((a) => !diagnoseCatalogItem(a).isFlaggedOrError)!;
    expect(verified).toBeDefined();
    expect(isCatalogAssetApproved(verified)).toBe(true);

    revokeCatalogAssetApproval(verified.id);
    expect(isCatalogAssetApproved(verified)).toBe(false);
    expect(getAdminApprovedAssetIds().has(verified.id)).toBe(false);

    approveCatalogAsset(verified.id);
    expect(isCatalogAssetApproved(verified)).toBe(true);
    expect(getAdminApprovedAssetIds().has(verified.id)).toBe(true);

    const flagged = catalogAssets.find((a) => diagnoseCatalogItem(a).isFlaggedOrError)!;
    expect(flagged).toBeDefined();
    expect(isCatalogAssetApproved(flagged)).toBe(false);

    approveCatalogAsset(flagged.id);
    expect(isCatalogAssetApproved(flagged)).toBe(true);
    expect(getAdminApprovedAssetIds().has(flagged.id)).toBe(true);

    revokeCatalogAssetApproval(flagged.id);
    expect(isCatalogAssetApproved(flagged)).toBe(false);
  });
});
