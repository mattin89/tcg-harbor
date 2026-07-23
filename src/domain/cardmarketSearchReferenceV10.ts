import {
  resolveCardmarketReferenceV8,
  type CardmarketReferenceInputV8,
  type CardmarketReferenceViewV8,
} from './cardmarketReferenceV8';

interface ArtworkReferenceV10 {
  readonly productId: number;
  readonly expansionId: number;
  readonly trend: number | null;
  readonly matchPolicy: 'cardmarket-image-correlation-v1' | 'cardmarket-image-correlation-v2-complete-candidates';
  readonly candidateCount?: number;
  readonly imageVerifiedAt?: string;
  readonly evidence: string;
}

export interface CatalogCardmarketAssetV10 extends CardmarketReferenceInputV8 {
  readonly id: string;
  readonly kind: 'card' | 'sealed';
  readonly variant: string;
  readonly setCode: string;
  readonly number?: string;
  readonly rulesCardId?: string;
  readonly sourcePrintingId?: string;
  readonly cardmarketArtworkReference?: ArtworkReferenceV10;
  readonly cardmarketRegularArtReference?: ArtworkReferenceV10;
}

export interface CatalogCardmarketReferenceViewV10 {
  readonly state:
    | 'regular-exact'
    | 'regular-image-reference'
    | 'regular-trend-unavailable'
    | 'regular-unavailable'
    | 'art-selection-required'
    | 'sealed';
  readonly displayValue: string;
  readonly label: string;
  readonly detail: string;
  readonly sourceAssetId: string | null;
}

export interface CardmarketArtworkReferenceViewV10 extends Omit<CardmarketReferenceViewV8, 'state'> {
  readonly state:
    | CardmarketReferenceViewV8['state']
    | 'artwork-unverified'
    | 'regular-image-reference'
    | 'artwork-image-reference';
}

const euroAmountV10 = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function usablePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function formatEur(value: number): string {
  return `${euroAmountV10.format(value)} €`;
}

function normalizedSetCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function originSetCode(asset: CatalogCardmarketAssetV10): string | null {
  return (asset.rulesCardId ?? asset.number ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .match(/^((?:OP|EB|PRB|ST)\d{2})-/)?.[1] ?? null;
}

function isRegularArt(asset: CatalogCardmarketAssetV10): boolean {
  return /^(?:standard|base art)$/i.test(asset.variant.trim());
}

function verifiedRegularIdentity(asset: CatalogCardmarketAssetV10): string | null {
  const reference = asset.cardmarketArtworkReference ?? asset.cardmarketRegularArtReference;
  if (reference && usablePrice(reference.trend)) {
    return `image:${reference.productId}:${reference.trend}`;
  }
  if (asset.cardmarketProductId != null && usablePrice(asset.quote.cardmarket)) {
    return `exact:${asset.cardmarketProductId}:${asset.quote.cardmarket}`;
  }
  return null;
}

function chooseEquivalentRegular(
  candidates: readonly CatalogCardmarketAssetV10[],
): CatalogCardmarketAssetV10 | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const identities = candidates.map(verifiedRegularIdentity);
  const uniqueVerifiedIdentities = new Set(identities.filter((identity) => identity != null));
  if (
    uniqueVerifiedIdentities.size === 1
    && identities.every((identity) => identity === identities[0])
  ) {
    return [...candidates].sort((left, right) => left.id.localeCompare(right.id))[0];
  }
  return null;
}

function chooseOriginalRegularArt(
  matched: CatalogCardmarketAssetV10,
  siblings: readonly CatalogCardmarketAssetV10[],
): CatalogCardmarketAssetV10 | null {
  const regular = siblings.filter((asset) => asset.kind === 'card' && isRegularArt(asset));
  if (regular.length === 0) return null;

  const rulesId = matched.rulesCardId ?? matched.number ?? null;
  const origin = originSetCode(matched);
  const originMatches = origin
    ? regular.filter((asset) => normalizedSetCode(asset.setCode).includes(origin))
    : [];
  if (origin && originMatches.length === 0) return null;

  const originPool = origin ? originMatches : regular;
  const identityMatches = rulesId
    ? originPool.filter((asset) => asset.sourcePrintingId === rulesId)
    : [];
  if (identityMatches.length > 0) return chooseEquivalentRegular(identityMatches);
  return origin ? chooseEquivalentRegular(originPool) : null;
}

/**
 * Search rows are card-number summaries, not exact-art valuations. They show
 * one independently verified original regular-art trend and never a candidate
 * range. A complete-candidate image match is promoted on its exact artwork;
 * the grouped row still intentionally summarizes the original regular art.
 */
export function resolveCatalogCardmarketReferenceV10(
  matched: CatalogCardmarketAssetV10,
  siblings: readonly CatalogCardmarketAssetV10[],
): CatalogCardmarketReferenceViewV10 {
  if (matched.kind === 'sealed') {
    const view = resolveCardmarketArtworkReferenceV10(matched);
    return {
      state: 'sealed',
      displayValue: view.displayValue,
      label: view.label,
      detail: view.detail,
      sourceAssetId: matched.id,
    };
  }

  const regular = chooseOriginalRegularArt(matched, siblings);
  if (!regular) {
    const pricedExactArts = siblings.filter((asset) =>
      asset.kind === 'card'
      && asset.cardmarketProductId != null
      && usablePrice(asset.quote.cardmarket)
      && (asset.cardmarketPriceState === 'available' || asset.cardmarketPriceState == null));
    if (pricedExactArts.length > 0) {
      return {
        state: 'art-selection-required',
        displayValue: 'Choose art',
        label: `${pricedExactArts.length} exact-art price${pricedExactArts.length === 1 ? '' : 's'}`,
        detail: `This card has no single regular-art market reference. Choose the exact artwork to see its verified Cardmarket trend; ${pricedExactArts.length} of ${siblings.length} sourced printings currently have an exact price.`,
        sourceAssetId: null,
      };
    }
    return {
      state: 'regular-unavailable',
      displayValue: 'Price unavailable',
      label: 'Regular art not verified',
      detail: 'No unique original regular-art printing has a verified Cardmarket product reference. Candidate ranges are intentionally not shown.',
      sourceAssetId: null,
    };
  }

  const reference = regular.cardmarketArtworkReference ?? regular.cardmarketRegularArtReference;
  if (reference && usablePrice(reference.trend)) {
    return {
      state: 'regular-image-reference',
      displayValue: formatEur(reference.trend),
      label: 'Regular art · image verified',
      detail: matched.id === regular.id
        ? 'The sourced regular artwork independently matches this Cardmarket product image. Its trend is stored as this exact artwork’s current value.'
        : 'The sourced regular artwork independently matches this Cardmarket product image. The selected alternative artwork keeps its own exact-art value.',
      sourceAssetId: regular.id,
    };
  }

  if (
    regular.cardmarketProductId != null
    && usablePrice(regular.quote.cardmarket)
    && (regular.cardmarketPriceState === 'available' || regular.cardmarketPriceState == null)
  ) {
    return {
      state: 'regular-exact',
      displayValue: formatEur(regular.quote.cardmarket),
      label: 'Regular art · exact trend',
      detail: matched.id === regular.id
        ? 'Verified exact Cardmarket trend for the original regular artwork.'
        : 'Verified Cardmarket trend for the original regular artwork. The selected alternative art keeps its own exact-art price and valuation state.',
      sourceAssetId: regular.id,
    };
  }

  if (regular.cardmarketProductId != null || reference) {
    return {
      state: 'regular-trend-unavailable',
      displayValue: 'Trend unavailable',
      label: 'Regular art · no current trend',
      detail: 'The regular-art Cardmarket product is verified, but the current daily price guide has no trend value.',
      sourceAssetId: regular.id,
    };
  }

  return {
    state: 'regular-unavailable',
    displayValue: 'Price unavailable',
    label: 'Regular art not verified',
    detail: regular.cardmarketPriceReason?.trim()
      || 'The public Cardmarket files do not provide a verified product identity for this regular artwork. Candidate ranges are intentionally not shown.',
    sourceAssetId: regular.id,
  };
}

/** Suppresses ambiguous candidate ranges in exact-art details and pickers. */
export function resolveCardmarketArtworkReferenceV10(
  input: CardmarketReferenceInputV8 & {
    readonly kind?: 'card' | 'sealed';
    readonly variant?: string;
    readonly cardmarketArtworkReference?: ArtworkReferenceV10;
    readonly cardmarketRegularArtReference?: ArtworkReferenceV10;
  },
): CardmarketArtworkReferenceViewV10 {
  const view = resolveCardmarketReferenceV8(input);
  if (input.kind === 'sealed') {
    return view.state === 'exact'
      ? {
        ...view,
        label: 'Exact product',
        detail: 'Verified exact Cardmarket sealed-product quote and official daily trend.',
      }
      : view;
  }
  const regular = /^(?:standard|base art)$/i.test(input.variant?.trim() ?? '');
  const reference = input.cardmarketArtworkReference
    ?? (regular ? input.cardmarketRegularArtReference : undefined);
  if (view.state === 'exact' && reference && usablePrice(reference.trend)) {
    return {
      state: regular ? 'regular-image-reference' : 'artwork-image-reference',
      displayValue: view.displayValue,
      label: regular ? 'Regular art · image verified' : 'Exact art · image verified',
      detail: `The sourced ${regular ? 'regular artwork' : 'selected artwork'} independently matches this Cardmarket product image. Its current trend is stored with collection acquisitions and included in value-growth tracking.`,
    };
  }
  if (view.state !== 'release-range') return view;
  if (reference && usablePrice(reference.trend)) {
    return {
      state: regular ? 'regular-image-reference' : 'artwork-image-reference',
      displayValue: formatEur(reference.trend),
      label: regular ? 'Regular art · image verified' : 'Exact art · image verified',
      detail: `The sourced ${regular ? 'regular artwork' : 'selected artwork'} independently matches this Cardmarket product image. Its current trend is stored with collection acquisitions and included in value-growth tracking.`,
    };
  }
  return {
    state: 'artwork-unverified',
    displayValue: 'Exact price unavailable',
    label: 'Artwork match not verified',
    detail: 'Cardmarket lists multiple products for this card and release but does not identify their artwork versions in its public catalog. No candidate price is used for this artwork, collection value, acquisition value, growth, or market comparison.',
  };
}
