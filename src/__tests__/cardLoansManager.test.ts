import { describe, expect, it } from 'vitest';
import type { DemoAsset } from '../data/demo';
import type { CommunityTradePostV6, LendingOfferSummary } from '../domain/communityTradingV6';
import {
  confirmLoanReturn,
  createBorrowedAsset,
  createLoanFromOffer,
  filterAssetsByTab,
  markAssetAsLent,
  restoreReturnedAsset,
} from '../domain/cardLoansManager';

const dummyLenderAsset: DemoAsset = {
  id: 'card-op01-016',
  collectionItemId: 'item-lender-001',
  kind: 'card',
  name: 'Nami',
  set: 'Romance Dawn',
  setCode: 'OP-01',
  number: 'OP01-016',
  rarity: 'Rare',
  variant: 'Alternate Art',
  language: 'English',
  condition: 'Near Mint',
  quantity: 1,
  purchasePrice: 45.0,
  purchaseCurrency: 'EUR',
  note: 'My favorite deck card from tournament 2024',
  addedAt: '2024-03-15T10:00:00.000Z',
  color: 'red',
  quote: { cardmarket: 65.5, tcgplayer: 72.0 },
  change: {
    cardmarket: { '1D': 0, '1W': 2.5, '1M': 5.0 },
    tcgplayer: { '1D': 0, '1W': 1.0, '1M': 3.0 },
  },
  acquisitionLots: [
    {
      id: 'lot-001',
      addedAt: '2024-03-15T10:00:00.000Z',
      quantity: 1,
      quoteAtAdd: { cardmarket: 45.0, tcgplayer: 50.0 },
      purchasePrice: 45.0,
      purchaseCurrency: 'EUR',
    },
  ],
};

const dummyTradePost: CommunityTradePostV6 = {
  id: 'post-borrow-001',
  communityId: 'comm-dresden',
  authorId: 'user-borrower',
  authorName: 'Borrower Ben',
  authorUsername: 'borrower_ben',
  authorInitials: 'BB',
  postKind: 'borrow_card',
  exchangeMode: 'open',
  cashAmountCents: null,
  primaryAssetId: 'card-op01-016',
  specificAssetId: null,
  offeredCollectionItemId: null,
  offeredQuantity: 0,
  quantity: 1,
  condition: 'near_mint',
  language: 'EN',
  notes: 'Need this card for local championship this weekend',
  status: 'open',
  createdAt: '2026-10-02T12:00:00.000Z',
  own: false,
};

const dummyOffer: LendingOfferSummary = {
  id: 'offer-001',
  tradePostId: 'post-borrow-001',
  lenderId: 'user-lender',
  lenderName: 'Lender Larry',
  lenderUsername: 'lender_larry',
  lenderCollectionItemId: 'item-lender-001',
  status: 'offered',
  createdAt: '2026-10-02T12:30:00.000Z',
};

describe('cardLoansManager', () => {
  it('creates an active loan contract capturing loan date and market value', () => {
    const loan = createLoanFromOffer({
      tradePost: dummyTradePost,
      offer: dummyOffer,
      lenderAsset: dummyLenderAsset,
      borrowerId: 'user-borrower',
      borrowerName: 'Borrower Ben',
      borrowerUsername: 'borrower_ben',
      lentAt: '2026-10-02T13:00:00.000Z',
      lentValueAmount: 65.5,
    });

    expect(loan.lenderId).toBe('user-lender');
    expect(loan.borrowerId).toBe('user-borrower');
    expect(loan.lentValueAmount).toBe(65.5);
    expect(loan.lentAt).toBe('2026-10-02T13:00:00.000Z');
    expect(loan.lenderReturned).toBe(false);
    expect(loan.borrowerReturned).toBe(false);
    expect(loan.status).toBe('active');
  });

  it('marks lender asset as lent while strictly preserving original metadata', () => {
    const loan = createLoanFromOffer({
      tradePost: dummyTradePost,
      offer: dummyOffer,
      lenderAsset: dummyLenderAsset,
      borrowerId: 'user-borrower',
      borrowerName: 'Borrower Ben',
      lentValueAmount: 65.5,
    });

    const lentAsset = markAssetAsLent(dummyLenderAsset, loan);

    expect(lentAsset.loan?.role).toBe('lender');
    expect(lentAsset.loan?.lentValueAmount).toBe(65.5);
    // Invariants: original data must never be altered or lost
    expect(lentAsset.addedAt).toBe('2024-03-15T10:00:00.000Z');
    expect(lentAsset.purchasePrice).toBe(45.0);
    expect(lentAsset.note).toBe('My favorite deck card from tournament 2024');
    expect(lentAsset.acquisitionLots).toHaveLength(1);
  });

  it('creates borrower asset under Borrowed section with loan reference', () => {
    const loan = createLoanFromOffer({
      tradePost: dummyTradePost,
      offer: dummyOffer,
      lenderAsset: dummyLenderAsset,
      borrowerId: 'user-borrower',
      borrowerName: 'Borrower Ben',
      lentValueAmount: 65.5,
    });

    const borrowedAsset = createBorrowedAsset(dummyLenderAsset, loan);

    expect(borrowedAsset.loan?.role).toBe('borrower');
    expect(borrowedAsset.loan?.otherPartyName).toBe('Lender Larry');
    expect(borrowedAsset.loan?.lentValueAmount).toBe(65.5);
    expect(borrowedAsset.quantity).toBe(1);
  });

  it('filters assets correctly into Cards, Sealed, Lent, and Borrowed tabs', () => {
    const loan = createLoanFromOffer({
      tradePost: dummyTradePost,
      offer: dummyOffer,
      lenderAsset: dummyLenderAsset,
      borrowerId: 'user-borrower',
      borrowerName: 'Borrower Ben',
      lentValueAmount: 65.5,
    });

    const lentAsset = markAssetAsLent(dummyLenderAsset, loan);
    const regularCard: DemoAsset = { ...dummyLenderAsset, id: 'card-op01-001' };
    const sealedAsset: DemoAsset = { ...dummyLenderAsset, id: 'sealed-001', kind: 'sealed' };
    const borrowedAsset = createBorrowedAsset(dummyLenderAsset, loan);

    const pool = [regularCard, sealedAsset, lentAsset, borrowedAsset];

    expect(filterAssetsByTab(pool, 'card')).toEqual([regularCard]);
    expect(filterAssetsByTab(pool, 'sealed')).toEqual([sealedAsset]);
    expect(filterAssetsByTab(pool, 'lent')).toEqual([lentAsset]);
    expect(filterAssetsByTab(pool, 'borrowed')).toEqual([borrowedAsset]);
  });

  it('requires mutual two-party confirmation before completing return', () => {
    const loan = createLoanFromOffer({
      tradePost: dummyTradePost,
      offer: dummyOffer,
      lenderAsset: dummyLenderAsset,
      borrowerId: 'user-borrower',
      borrowerName: 'Borrower Ben',
      lentValueAmount: 65.5,
    });

    // Step 1: Lender clicks Returned
    const step1 = confirmLoanReturn(loan, 'user-lender');
    expect(step1.updatedLoan.lenderReturned).toBe(true);
    expect(step1.updatedLoan.borrowerReturned).toBe(false);
    expect(step1.isFullyReturned).toBe(false);
    expect(step1.updatedLoan.status).toBe('active');

    // Step 2: Borrower clicks Returned
    const step2 = confirmLoanReturn(step1.updatedLoan, 'user-borrower');
    expect(step2.updatedLoan.lenderReturned).toBe(true);
    expect(step2.updatedLoan.borrowerReturned).toBe(true);
    expect(step2.isFullyReturned).toBe(true);
    expect(step2.updatedLoan.status).toBe('returned');
  });

  it('restores the returned card to active collection preserving original history', () => {
    const loan = createLoanFromOffer({
      tradePost: dummyTradePost,
      offer: dummyOffer,
      lenderAsset: dummyLenderAsset,
      borrowerId: 'user-borrower',
      borrowerName: 'Borrower Ben',
      lentValueAmount: 65.5,
    });

    const lentAsset = markAssetAsLent(dummyLenderAsset, loan);
    const restored = restoreReturnedAsset(lentAsset);

    expect(restored.loan).toBeUndefined();
    expect(restored.addedAt).toBe('2024-03-15T10:00:00.000Z');
    expect(restored.purchasePrice).toBe(45.0);
    expect(restored.note).toBe('My favorite deck card from tournament 2024');
    expect(restored.acquisitionLots).toHaveLength(1);
  });
});
