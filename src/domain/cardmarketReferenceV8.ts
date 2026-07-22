export type CardmarketPriceStateV8 =
  | 'available'
  | 'trend-unavailable'
  | 'ambiguous-artwork'
  | 'unmapped'
  | 'not-listed';

export interface CardmarketReferenceInputV8 {
  readonly quote: { readonly cardmarket: number | null };
  readonly cardmarketProductId?: number | null;
  readonly cardmarketPriceState?: CardmarketPriceStateV8;
  readonly cardmarketPriceReason?: string;
  readonly cardmarketCandidateExpansionId?: number | null;
  readonly cardmarketCandidates?: ReadonlyArray<{
    readonly productId: number;
    readonly trend: number | null;
  }> | null;
  readonly cardmarketCandidatePriceRange?: {
    readonly minimumTrend: number | null;
    readonly maximumTrend: number | null;
    readonly pricedCandidates: number;
    readonly totalCandidates: number;
  } | null;
}

export interface CardmarketReferenceViewV8 {
  readonly state: 'exact' | 'release-range' | 'exact-trend-unavailable' | 'unmapped' | 'not-listed';
  readonly displayValue: string;
  readonly label: string;
  readonly detail: string;
}

const euroAmountV8 = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function isUsablePriceV8(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function formatEurV8(value: number): string {
  return `${euroAmountV8.format(value)} €`;
}

function candidateCountV8(input: CardmarketReferenceInputV8): number {
  const declared = input.cardmarketCandidatePriceRange?.totalCandidates;
  if (typeof declared === 'number' && Number.isInteger(declared) && declared > 0) return declared;
  return input.cardmarketCandidates?.length ?? 0;
}

function releaseRangeValueV8(input: CardmarketReferenceInputV8): string {
  const minimum = input.cardmarketCandidatePriceRange?.minimumTrend;
  const maximum = input.cardmarketCandidatePriceRange?.maximumTrend;
  const usableMinimum = isUsablePriceV8(minimum) ? minimum : null;
  const usableMaximum = isUsablePriceV8(maximum) ? maximum : null;

  if (usableMinimum !== null && usableMaximum !== null) {
    return usableMinimum === usableMaximum
      ? formatEurV8(usableMinimum)
      : `${euroAmountV8.format(usableMinimum)}–${euroAmountV8.format(usableMaximum)} €`;
  }
  if (usableMinimum !== null) return formatEurV8(usableMinimum);
  if (usableMaximum !== null) return formatEurV8(usableMaximum);
  return 'No candidate trend';
}

/**
 * Produces display-only Cardmarket copy for a catalog printing. Candidate
 * ranges intentionally remain outside `quote.cardmarket`, which is reserved
 * for an exact artwork/product match and is the only value used by valuation.
 */
export function resolveCardmarketReferenceV8(
  input: CardmarketReferenceInputV8,
): CardmarketReferenceViewV8 {
  const exactTrend = input.quote.cardmarket;
  if (
    isUsablePriceV8(exactTrend)
    && (input.cardmarketPriceState === 'available' || input.cardmarketPriceState == null)
  ) {
    return {
      state: 'exact',
      displayValue: formatEurV8(exactTrend),
      label: 'Exact artwork',
      detail: 'Verified exact Cardmarket product and official daily trend.',
    };
  }

  if (input.cardmarketPriceState === 'ambiguous-artwork') {
    const candidates = candidateCountV8(input);
    const candidateLabel = candidates === 1 ? 'candidate' : 'candidates';
    const expansion = input.cardmarketCandidateExpansionId != null
      ? ` in release ${input.cardmarketCandidateExpansionId}`
      : ' in the matched release';
    return {
      state: 'release-range',
      displayValue: releaseRangeValueV8(input),
      label: `${candidates} Cardmarket release ${candidateLabel}`,
      detail: `Selected artwork is not verified; ${candidates} product ${candidateLabel}${expansion}. This range is reference-only and excluded from collection value, acquisition value, growth, and market comparison.`,
    };
  }

  if (input.cardmarketPriceState === 'not-listed') {
    return {
      state: 'not-listed',
      displayValue: 'Not listed',
      label: 'Not listed on Cardmarket',
      detail: input.cardmarketPriceReason?.trim()
        || 'No Cardmarket listing is present for this exact printing in the current catalog.',
    };
  }

  if (
    input.cardmarketPriceState === 'available'
    || input.cardmarketPriceState === 'trend-unavailable'
    || (input.cardmarketProductId != null && !isUsablePriceV8(exactTrend))
  ) {
    return {
      state: 'exact-trend-unavailable',
      displayValue: 'Trend unavailable',
      label: 'Exact artwork · no current trend',
      detail: input.cardmarketPriceReason?.trim()
        || 'The exact Cardmarket product is verified, but its current daily price guide has no trend.',
    };
  }

  return {
    state: 'unmapped',
    displayValue: 'Exact price unavailable',
    label: 'Exact artwork not mapped',
    detail: input.cardmarketPriceReason?.trim()
      || 'No exact Cardmarket product mapping is verified for this printing.',
  };
}
