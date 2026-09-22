import { describe, expect, it } from 'vitest';
import { catalogAssets, marketDataMeta, type DemoAsset } from '../data/demo';
import { resolveCardmarketArtworkReferenceV10 } from '../domain/cardmarketSearchReferenceV10';

const cards = catalogAssets.filter((asset) => asset.kind === 'card');

describe('Cardmarket per-art snapshot v10', () => {
  it('promotes only complete-candidate image matches and limits repeated products to explicit physical aliases', () => {
    const references = cards.filter((asset) => asset.cardmarketArtworkReference != null);
    const alternateReferences = references.filter(
      (asset) => !/^(?:standard|base art)$/i.test(asset.variant),
    );
    const policy = marketDataMeta.cardmarketCoverage.artworkReferencePolicy;

    expect(references).toHaveLength(
      marketDataMeta.catalogCounts.cardmarketImageVerifiedArtworkReferences,
    );
    expect(alternateReferences).toHaveLength(
      marketDataMeta.catalogCounts.cardmarketImageVerifiedAlternativeArtReferences,
    );
    expect(references.length).toBe(policy.persistedReferences + policy.discoveredReferences);
    expect(alternateReferences.length).toBeGreaterThan(700);

    const sourceDigestsByProduct = new Map<number, Set<string>>();

    for (const asset of references) {
      const reference = asset.cardmarketArtworkReference as NonNullable<
        DemoAsset['cardmarketArtworkReference']
      >;
      expect(reference.matchPolicy).toBe('cardmarket-image-correlation-v2-complete-candidates');
      expect(asset.cardmarketPriceState).toBe(reference.trend == null ? 'trend-unavailable' : 'available');
      expect(asset.cardmarketProductId).toBe(reference.productId);
      expect(asset.quote.cardmarket).toBe(reference.trend);
      expect(asset.cardmarketCandidates?.some(
        (candidate) => candidate.productId === reference.productId
          && candidate.trend === reference.trend,
      )).toBe(true);
      if (reference.reviewedMappingId) {
        expect(reference.reviewedMappingId)
          .toBe(`${asset.sourcePrintingId}:${asset.cardmarketProductId}`);
        expect(reference.reviewedMinimumCorrelation).toBeGreaterThanOrEqual(0.9);
        expect(reference.correlation)
          .toBeGreaterThanOrEqual(reference.reviewedMinimumCorrelation ?? 1);
        expect(reference.margin).toBeGreaterThan(0);
      } else {
        expect(reference.correlation).toBeGreaterThanOrEqual(policy.minimumCorrelation);
        expect(reference.margin).toBeGreaterThanOrEqual(policy.minimumMargin);
      }
      expect(reference.candidateCount).toBe(asset.cardmarketCandidates?.length);
      if ((reference.candidateCount ?? 0) > 1) {
        expect(reference.runnerUpCorrelation).not.toBeNull();
      }
      const sourceDigests = sourceDigestsByProduct.get(reference.productId) ?? new Set<string>();
      sourceDigests.add(reference.sourceImageDigest!);
      sourceDigestsByProduct.set(reference.productId, sourceDigests);
    }

    expect([...sourceDigestsByProduct.values()].every((digests) => digests.size === 1)).toBe(true);
    const referencesByProduct = new Map<number, DemoAsset[]>();
    for (const asset of references) {
      const productId = Number(asset.cardmarketProductId);
      referencesByProduct.set(productId, [...(referencesByProduct.get(productId) ?? []), asset]);
    }
    for (const [productId, productReferences] of referencesByProduct) {
      if (productReferences.length === 1) continue;
      const canonical = productReferences.filter((asset) => !asset.catalogAliasOf);
      expect(canonical, String(productId)).toHaveLength(1);
      for (const alias of productReferences.filter((asset) => asset.catalogAliasOf)) {
        expect(alias.catalogAliasOf, alias.id).toBe(canonical[0].id);
        expect(alias.rulesCardId, alias.id).toBe(canonical[0].rulesCardId);
        expect(alias.setCode, alias.id).toBe(canonical[0].setCode);
        expect(alias.sourcePrintingId, alias.id).toBe(canonical[0].sourcePrintingId);
        expect(alias.quote.cardmarket, alias.id).toBe(canonical[0].quote.cardmarket);
        expect(alias.cardmarketArtworkReference?.sourceImageDigest, alias.id)
          .toBe(canonical[0].cardmarketArtworkReference?.sourceImageDigest);
      }
    }
  });

  it('separates the Fire Fist regular and alternate prices by verified artwork', () => {
    const fireFist = cards.filter((asset) => asset.rulesCardId === 'OP03-018');
    const regular = fireFist.find((asset) => asset.sourcePrintingId === 'OP03-018');
    const alternate = fireFist.find((asset) => asset.sourcePrintingId === 'OP03-018_p1');

    expect(regular?.cardmarketArtworkReference).toMatchObject({
      productId: 719388,
    });
    expect(alternate?.cardmarketArtworkReference).toMatchObject({
      productId: 719387,
    });
    expect(regular?.cardmarketArtworkReference?.trend).not.toBeNull();
    expect(alternate?.cardmarketArtworkReference?.trend).not.toBeNull();
    expect(resolveCardmarketArtworkReferenceV10(regular!)).toMatchObject({
      state: 'regular-image-reference',
    });
    expect(resolveCardmarketArtworkReferenceV10(alternate!)).toMatchObject({
      state: 'artwork-image-reference',
    });
  });

  it('uses image identity rather than product order for Kouzuki Oden', () => {
    const oden = cards.filter((asset) => asset.rulesCardId === 'EB01-001');
    expect(oden.find((asset) => asset.variant === 'Standard')?.cardmarketArtworkReference)
      .toMatchObject({ productId: 767953 });
    expect(oden.find((asset) => asset.variant === 'Alternate art · P1')?.cardmarketArtworkReference)
      .toMatchObject({ productId: 767954 });
  });

  it('keeps the reviewed latest-starter mappings digest-locked', () => {
    const reviewed = cards.filter(
      (asset) => asset.cardmarketArtworkReference?.reviewedMappingId,
    );

    expect(marketDataMeta.cardmarketCoverage.artworkReferencePolicy.reviewedDigestMappings)
      .toBe(6);
    expect(reviewed.map(
      (asset) => asset.cardmarketArtworkReference?.reviewedMappingId,
    ).sort()).toEqual([
      'ST30-015:891044',
      'ST30-015_p1:891045',
      'ST30-016:891046',
      'ST30-016_p1:891047',
      'ST30-017:891048',
      'ST30-017_p1:891049',
    ]);
    expect(reviewed.every(
      (asset) => asset.setCode === 'ST30'
        && asset.cardmarketPriceState === 'available'
        && asset.quote.cardmarket === asset.cardmarketArtworkReference?.trend,
    )).toBe(true);
  });

  it('groups starter-deck reprints under their printed promotional card number', () => {
    const expectedRulesIds = new Map([
      ['P-029_r1', 'P-029'],
      ['P-057_p1', 'P-057'],
      ['P-058_p1', 'P-058'],
      ['P-059_p1', 'P-059'],
      ['P-060_p1', 'P-060'],
      ['P-061_r1', 'P-061'],
      ['P-030_r1', 'P-030'],
      ['P-041_r1', 'P-041'],
    ]);

    for (const [sourcePrintingId, rulesCardId] of expectedRulesIds) {
      const asset = cards.find((candidate) => candidate.sourcePrintingId === sourcePrintingId);
      expect(asset, sourcePrintingId).toBeDefined();
      expect(asset?.rulesCardId, sourcePrintingId).toBe(rulesCardId);
      expect(cards.filter((candidate) => candidate.rulesCardId === rulesCardId).length)
        .toBeGreaterThan(1);
    }
    expect(cards.some((asset) => /_(?:PR|P|R)\d+$/i.test(asset.rulesCardId ?? ''))).toBe(false);
  });
});
