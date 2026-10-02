import type { DemoAsset } from '../data/demo';
import type { CardLoanSummary, CommunityTradePostV6, LendingOfferSummary } from './communityTradingV6';

export const LOCAL_CARD_LOANS_KEY = 'tcg-harbor-card-loans-v1';

export function createLoanFromOffer(params: {
  readonly tradePost: CommunityTradePostV6;
  readonly offer: LendingOfferSummary;
  readonly lenderAsset: DemoAsset;
  readonly borrowerId: string;
  readonly borrowerName: string;
  readonly borrowerUsername?: string;
  readonly lentAt?: string;
  readonly lentValueAmount: number;
}): CardLoanSummary {
  const lentAt = params.lentAt ?? new Date().toISOString();
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `loan-${crypto.randomUUID()}`
    : `loan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    tradePostId: params.tradePost.id,
    communityId: params.tradePost.communityId,
    lenderId: params.offer.lenderId,
    lenderName: params.offer.lenderName,
    lenderUsername: params.offer.lenderUsername,
    borrowerId: params.borrowerId,
    borrowerName: params.borrowerName,
    borrowerUsername: params.borrowerUsername,
    cardVariantId: params.lenderAsset.id,
    sourceCollectionItemId: params.lenderAsset.collectionItemId,
    role: 'lender',
    otherPartyId: params.borrowerId,
    otherPartyName: params.borrowerName,
    otherPartyUsername: params.borrowerUsername,
    lentAt,
    lentValueAmount: params.lentValueAmount,
    lentValueCurrency: 'EUR',
    lenderReturned: false,
    borrowerReturned: false,
    status: 'active',
  };
}

export function markAssetAsLent(asset: DemoAsset, loan: CardLoanSummary): DemoAsset {
  return {
    ...asset,
    loan: {
      ...loan,
      role: 'lender',
      otherPartyId: loan.borrowerId,
      otherPartyName: loan.borrowerName,
      otherPartyUsername: loan.borrowerUsername,
    },
  };
}

export function createBorrowedAsset(catalogCard: DemoAsset, loan: CardLoanSummary): DemoAsset {
  return {
    ...catalogCard,
    id: `borrowed-${loan.id}`,
    collectionItemId: `borrowed-item-${loan.id}`,
    quantity: 1,
    addedAt: loan.lentAt,
    loan: {
      ...loan,
      role: 'borrower',
      otherPartyId: loan.lenderId,
      otherPartyName: loan.lenderName,
      otherPartyUsername: loan.lenderUsername,
    },
  };
}

export function confirmLoanReturn(
  loan: CardLoanSummary,
  callerUserId: string,
): { readonly updatedLoan: CardLoanSummary; readonly isFullyReturned: boolean } {
  const isLender = callerUserId === loan.lenderId;
  const isBorrower = callerUserId === loan.borrowerId;

  const lenderReturned = isLender ? true : loan.lenderReturned;
  const borrowerReturned = isBorrower ? true : loan.borrowerReturned;
  const isFullyReturned = lenderReturned && borrowerReturned;

  const updatedLoan: CardLoanSummary = {
    ...loan,
    lenderReturned,
    borrowerReturned,
    status: isFullyReturned ? 'returned' : 'active',
  };

  return { updatedLoan, isFullyReturned };
}

export function restoreReturnedAsset(asset: DemoAsset): DemoAsset {
  const copy = { ...asset };
  delete copy.loan;
  return copy;
}

export function filterAssetsByTab(
  assets: readonly DemoAsset[],
  tab: 'card' | 'sealed' | 'lent' | 'borrowed',
): DemoAsset[] {
  if (tab === 'card') {
    return assets.filter((asset) => asset.kind === 'card' && !asset.loan);
  }
  if (tab === 'sealed') {
    return assets.filter((asset) => asset.kind === 'sealed' && !asset.loan);
  }
  if (tab === 'lent') {
    return assets.filter(
      (asset) => asset.loan?.role === 'lender' && asset.loan.status === 'active',
    );
  }
  if (tab === 'borrowed') {
    return assets.filter(
      (asset) => asset.loan?.role === 'borrower' && asset.loan.status === 'active',
    );
  }
  return [];
}

export function loadLocalLoans(): CardLoanSummary[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_CARD_LOANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalLoans(loans: readonly CardLoanSummary[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_CARD_LOANS_KEY, JSON.stringify(loans));
  } catch {
    // Ignore localStorage persistence errors
  }
}
