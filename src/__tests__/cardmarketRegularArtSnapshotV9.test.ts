import { describe, expect, it } from 'vitest';
import { catalogAssets, marketDataMeta, type DemoAsset } from '../data/demo';
import {
  resolveCatalogCardmarketReferenceV9,
  type CatalogCardmarketAssetV9,
} from '../domain/cardmarketSearchReferenceV9';

type SnapshotCatalogCardV10 = CatalogCardmarketAssetV9 & Pick<
  DemoAsset,
  'cardmarketArtworkReference' | 'catalogAliasOf'
>;

const cards = catalogAssets.filter((asset) => asset.kind === 'card') as SnapshotCatalogCardV10[];

function cardGroups(): SnapshotCatalogCardV10[][] {
  const groups = new Map<string, SnapshotCatalogCardV10[]>();
  for (const asset of cards) {
    const id = asset.rulesCardId ?? asset.number ?? asset.id;
    const group = groups.get(id) ?? [];
    group.push(asset);
    groups.set(id, group);
  }
  return [...groups.values()];
}

describe('Cardmarket regular-art snapshot compatibility', () => {
  it('keeps every complete-candidate image-verified regular-art mapping auditable', () => {
    const references = cards.filter((asset) => asset.cardmarketRegularArtReference != null);
    const policy = marketDataMeta.cardmarketCoverage.regularArtReferencePolicy;

    expect(references).toHaveLength(
      marketDataMeta.catalogCounts.cardmarketImageVerifiedRegularArtReferences,
    );
    expect(references.length).toBeGreaterThan(400);
    expect(references.length).toBe(policy.persistedReferences + policy.discoveredReferences);

    for (const asset of references) {
      const reference = asset.cardmarketRegularArtReference as NonNullable<
        DemoAsset['cardmarketRegularArtReference']
      >;
      const candidate = asset.cardmarketCandidates?.find(
        ({ productId }) => productId === reference.productId,
      );

      expect(asset.variant).toBe('Standard');
      expect(asset.sourcePrintingId).toBe(asset.rulesCardId);
      expect(reference.matchPolicy).toBe('cardmarket-image-correlation-v2-complete-candidates');
      expect(asset.cardmarketPriceState).toBe(reference.trend == null ? 'trend-unavailable' : 'available');
      expect(asset.cardmarketProductId).toBe(reference.productId);
      expect(asset.quote.cardmarket).toBe(reference.trend);
      expect(candidate).toBeDefined();
      expect(reference.expansionId).toBe(asset.cardmarketCandidateExpansionId);
      expect(reference.trend).toBe(candidate?.trend ?? null);
      expect(reference.correlation).toBeGreaterThanOrEqual(policy.minimumCorrelation);
      expect(reference.margin).toBeGreaterThanOrEqual(policy.minimumMargin);
      expect(reference.candidateCount).toBe(asset.cardmarketCandidates?.length);
      expect(reference.sourceImageUrl).toMatch(/^https:\/\/optcgapi\.com\//);
      expect(reference.productImageUrl).toMatch(
        /^https:\/\/product-images\.s3\.cardmarket\.com\//,
      );
      expect(reference.sourceImageDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(reference.productImageDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('renders one regular-art price or an honest unavailable state for every card search group', () => {
    const groups = cardGroups();
    const views = groups.map((group) => resolveCatalogCardmarketReferenceV9(group[0], group));

    expect(groups.length).toBeGreaterThan(2_500);
    expect(views.filter((view) => view.state === 'regular-exact').length)
      .toBeGreaterThan(400);
    expect(views.every((view) => !view.displayValue.includes('–'))).toBe(true);
    expect(views.every((view) => !/^\d.+(?:-|–).+\d/.test(view.displayValue))).toBe(true);
    expect(views.every((view) => (
      view.displayValue.endsWith('€')
      || view.displayValue === 'Price unavailable'
      || view.displayValue === 'Trend unavailable'
    ))).toBe(true);
  });

  it('uses the image-verified regular Fire Fist price without assigning its alternate-art value', () => {
    const fireFist = cards.filter((asset) => asset.rulesCardId === 'OP03-018');
    const regular = fireFist.find((asset) => asset.sourcePrintingId === 'OP03-018');
    const alternate = fireFist.find((asset) => asset.sourcePrintingId === 'OP03-018_p1');
    const view = resolveCatalogCardmarketReferenceV9(alternate!, fireFist);
    const regularReference = regular?.cardmarketRegularArtReference as NonNullable<
      DemoAsset['cardmarketRegularArtReference']
    > | undefined;

    expect(fireFist).toHaveLength(2);
    expect(regularReference?.productId).toBe(719388);
    expect(view).toMatchObject({
      state: 'regular-exact',
      sourceAssetId: regular?.id,
    });
    expect(view.displayValue).toBe(`${new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(regularReference!.trend!)} €`);
    expect(view.displayValue).not.toContain(
      new Intl.NumberFormat('de-DE').format(
        alternate!.cardmarketCandidates!.find(({ productId }) => productId === 719387)!.trend!,
      ),
    );
    expect(regular?.quote.cardmarket).toBe(regularReference?.trend);
    expect(alternate?.quote.cardmarket).toBe(
      alternate?.cardmarketArtworkReference?.trend,
    );
  });

  it('keeps priced origin releases and values legacy duplicate rows through one canonical physical art', () => {
    const reprinted = cards.filter((asset) => asset.rulesCardId === 'OP10-063');
    const origin = reprinted.find((asset) => asset.setCode === 'OP10');
    const duplicateSources = cards.filter((asset) => asset.rulesCardId === 'OP13-084');
    const duplicateReferences = duplicateSources.filter(
      (asset) => asset.cardmarketRegularArtReference != null,
    );

    expect(resolveCatalogCardmarketReferenceV9(reprinted[0], reprinted)).toMatchObject({
      state: 'regular-exact',
      sourceAssetId: origin?.id,
      displayValue: '0,11 €',
    });
    expect(duplicateReferences).toHaveLength(2);
    const canonical = duplicateReferences.find((asset) => !asset.catalogAliasOf);
    const aliases = duplicateReferences.filter((asset) => asset.catalogAliasOf);
    expect(canonical).toBeDefined();
    expect(aliases).toHaveLength(1);
    expect(aliases[0].catalogAliasOf).toBe(canonical?.id);
    expect(aliases[0].cardmarketProductId).toBe(canonical?.cardmarketProductId);
    expect(aliases[0].quote.cardmarket).toBe(canonical?.quote.cardmarket);
    expect(resolveCatalogCardmarketReferenceV9(duplicateSources[0], duplicateSources)).toMatchObject({
      state: 'regular-exact',
      displayValue: '0,26 €',
    });
  });
});
