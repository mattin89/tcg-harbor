import { describe, expect, it } from 'vitest';
import { catalogAssets, marketDataMeta, type DemoAsset } from '../data/demo';
import {
  resolveCatalogCardmarketReferenceV9,
  type CatalogCardmarketAssetV9,
} from '../domain/cardmarketSearchReferenceV9';

const cards = catalogAssets.filter((asset) => asset.kind === 'card') as CatalogCardmarketAssetV9[];

function cardGroups(): CatalogCardmarketAssetV9[][] {
  const groups = new Map<string, CatalogCardmarketAssetV9[]>();
  for (const asset of cards) {
    const id = asset.rulesCardId ?? asset.number ?? asset.id;
    const group = groups.get(id) ?? [];
    group.push(asset);
    groups.set(id, group);
  }
  return [...groups.values()];
}

describe('Cardmarket regular-art snapshot v9', () => {
  it('keeps every image-verified regular-art reference display-only and auditable', () => {
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
      expect(asset.cardmarketPriceState).toBe('ambiguous-artwork');
      expect(asset.cardmarketProductId).toBeNull();
      expect(asset.quote.cardmarket).toBeNull();
      expect(candidate).toBeDefined();
      expect(reference.expansionId).toBe(asset.cardmarketCandidateExpansionId);
      expect(reference.trend).toBe(candidate?.trend ?? null);
      expect(reference.correlation).toBeGreaterThanOrEqual(policy.minimumCorrelation);
      expect(reference.margin).toBeGreaterThanOrEqual(policy.minimumMargin);
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
    expect(views.filter((view) => view.state === 'regular-image-reference').length)
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
      state: 'regular-image-reference',
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
    expect(regular?.quote.cardmarket).toBeNull();
    expect(alternate?.quote.cardmarket).toBeNull();
  });

  it('keeps priced origin releases and equivalent duplicate source rows visible', () => {
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
    expect(new Set(duplicateReferences.map(
      (asset) => asset.cardmarketRegularArtReference?.productId,
    )).size).toBe(1);
    expect(resolveCatalogCardmarketReferenceV9(duplicateSources[0], duplicateSources)).toMatchObject({
      state: 'regular-image-reference',
      displayValue: '0,26 €',
    });
  });
});
