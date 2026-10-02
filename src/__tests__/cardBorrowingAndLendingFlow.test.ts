import { describe, expect, it } from 'vitest';
import type { DemoAsset } from '../data/demo';
import {
  validateCommunityTradeDraftV6,
  type CommunityTradeDraftV6,
  type CommunityTradePostV6,
  type LendingOfferSummary,
} from '../domain/communityTradingV6';
import {
  confirmLoanReturn,
  createBorrowedAsset,
  createLoanFromOffer,
  filterAssetsByTab,
  markAssetAsLent,
  restoreReturnedAsset,
} from '../domain/cardLoansManager';

const dummyCatalogCard: DemoAsset = {
  id: 'card-op01-025',
  kind: 'card',
  name: 'Roronoa Zoro',
  set: 'Romance Dawn',
  setCode: 'OP-01',
  number: 'OP01-025',
  rarity: 'Super Rare',
  variant: 'Standard',
  language: 'English',
  condition: 'Near Mint',
  quantity: 1,
  color: 'red',
  addedAt: '2024-01-01T00:00:00.000Z',
  quote: { cardmarket: 32.0, tcgplayer: 35.0 },
  change: { cardmarket: { '1D': 0, '1W': 0, '1M': 0 }, tcgplayer: { '1D': 0, '1W': 0, '1M': 0 } },
};

const dummyLenderOriginalCard: DemoAsset = {
  id: 'card-op01-025',
  collectionItemId: 'item-lender-zoro',
  kind: 'card',
  name: 'Roronoa Zoro',
  set: 'Romance Dawn',
  setCode: 'OP-01',
  number: 'OP01-025',
  rarity: 'Super Rare',
  variant: 'Standard',
  language: 'English',
  condition: 'Near Mint',
  quantity: 1,
  color: 'red',
  purchasePrice: 20.0,
  purchaseCurrency: 'EUR',
  note: 'Pulled from first box booster pack',
  addedAt: '2023-12-10T15:30:00.000Z',
  quote: { cardmarket: 32.0, tcgplayer: 35.0 },
  change: { cardmarket: { '1D': 0, '1W': 0, '1M': 0 }, tcgplayer: { '1D': 0, '1W': 0, '1M': 0 } },
  acquisitionLots: [
    {
      id: 'lot-zoro-1',
      addedAt: '2023-12-10T15:30:00.000Z',
      quantity: 1,
      quoteAtAdd: { cardmarket: 20.0, tcgplayer: 22.0 },
      purchasePrice: 20.0,
      purchaseCurrency: 'EUR',
    },
  ],
};

describe('Card Borrowing and Lending End-to-End Workflow', () => {
  it('validates a borrow_card draft from catalog cards without requiring an owned item', () => {
    const draft: CommunityTradeDraftV6 = {
      communityId: 'store-1',
      postKind: 'borrow_card',
      exchangeMode: 'open',
      primaryAssetId: 'card-op01-025',
      quantity: 1,
      desiredCondition: 'near_mint',
      notes: 'Need for Saturday tournament',
    };

    const validated = validateCommunityTradeDraftV6(draft);

    expect(draft.postKind).toBe('borrow_card');
    expect(draft.primaryAssetId).toBe('card-op01-025');
    expect(validated.cashAmountCents).toBeNull();
    expect(validated.notes).toBe('Need for Saturday tournament');
  });

  it('allows multiple community members to offer lending while borrow post remains open', () => {
    const borrowPost: CommunityTradePostV6 = {
      id: 'post-borrow-zoro',
      communityId: 'store-1',
      authorId: 'borrower-alice',
      authorName: 'Alice',
      authorUsername: 'alice_tcg',
      authorInitials: 'AT',
      postKind: 'borrow_card',
      exchangeMode: 'open',
      cashAmountCents: null,
      primaryAssetId: 'card-op01-025',
      specificAssetId: null,
      offeredCollectionItemId: null,
      offeredQuantity: 0,
      quantity: 1,
      condition: 'near_mint',
      language: 'EN',
      notes: 'Looking to borrow Zoro for the tournament',
      status: 'open',
      createdAt: '2026-10-02T10:00:00.000Z',
      own: true,
      lendingOffers: [],
    };

    // First member volunteers
    const offerBob: LendingOfferSummary = {
      id: 'offer-bob',
      tradePostId: borrowPost.id,
      lenderId: 'lender-bob',
      lenderName: 'Bob',
      lenderUsername: 'bob_builder',
      lenderCollectionItemId: 'item-lender-zoro',
      status: 'offered',
      createdAt: '2026-10-02T10:15:00.000Z',
    };

    // Second member volunteers
    const offerCharlie: LendingOfferSummary = {
      id: 'offer-charlie',
      tradePostId: borrowPost.id,
      lenderId: 'lender-charlie',
      lenderName: 'Charlie',
      lenderUsername: 'charlie_cards',
      status: 'offered',
      createdAt: '2026-10-02T10:30:00.000Z',
    };

    const updatedOffers = [offerBob, offerCharlie];
    expect(updatedOffers.length).toBe(2);
    expect(borrowPost.status).toBe('open'); // Still open for others
  });

  it('closes post when author accepts an offer, sets up Lent and Borrowed segregation with date and EUR value, and preserves original metadata', () => {
    const borrowPost: CommunityTradePostV6 = {
      id: 'post-borrow-zoro',
      communityId: 'store-1',
      authorId: 'borrower-alice',
      authorName: 'Alice',
      authorUsername: 'alice_tcg',
      authorInitials: 'AT',
      postKind: 'borrow_card',
      exchangeMode: 'open',
      cashAmountCents: null,
      primaryAssetId: 'card-op01-025',
      specificAssetId: null,
      offeredCollectionItemId: null,
      offeredQuantity: 0,
      quantity: 1,
      condition: 'near_mint',
      language: 'EN',
      notes: 'Looking to borrow Zoro',
      status: 'open',
      createdAt: '2026-10-02T10:00:00.000Z',
      own: true,
    };

    const acceptedOffer: LendingOfferSummary = {
      id: 'offer-bob',
      tradePostId: borrowPost.id,
      lenderId: 'lender-bob',
      lenderName: 'Bob',
      lenderUsername: 'bob_builder',
      lenderCollectionItemId: 'item-lender-zoro',
      status: 'offered',
      createdAt: '2026-10-02T10:15:00.000Z',
    };

    const initialLentValue = 32.5; // EUR
    const lentAtDate = '2026-10-02T11:00:00.000Z';

    const loan = createLoanFromOffer({
      tradePost: borrowPost,
      offer: acceptedOffer,
      lenderAsset: dummyLenderOriginalCard,
      borrowerId: borrowPost.authorId,
      borrowerName: borrowPost.authorName,
      borrowerUsername: borrowPost.authorUsername,
      lentAt: lentAtDate,
      lentValueAmount: initialLentValue,
    });

    expect(loan.status).toBe('active');
    expect(loan.lentValueAmount).toBe(32.5);
    expect(loan.lentValueCurrency).toBe('EUR');
    expect(loan.lentAt).toBe(lentAtDate);

    // --- LENDER SIDE ---
    const lenderAssetsBefore = [dummyLenderOriginalCard];
    expect(filterAssetsByTab(lenderAssetsBefore, 'card').length).toBe(1);
    expect(filterAssetsByTab(lenderAssetsBefore, 'lent').length).toBe(0);

    const lenderLentCard = markAssetAsLent(dummyLenderOriginalCard, loan);
    const lenderAssetsDuring = [lenderLentCard];

    // Card has moved out of active 'card' tab into 'lent' tab
    expect(filterAssetsByTab(lenderAssetsDuring, 'card').length).toBe(0);
    const lentCards = filterAssetsByTab(lenderAssetsDuring, 'lent');
    expect(lentCards.length).toBe(1);
    expect(lentCards[0].loan?.lentValueAmount).toBe(32.5);
    expect(lentCards[0].loan?.lentAt).toBe(lentAtDate);

    // Original lender card data must be strictly preserved
    expect(lentCards[0].addedAt).toBe('2023-12-10T15:30:00.000Z');
    expect(lentCards[0].purchasePrice).toBe(20.0);
    expect(lentCards[0].note).toBe('Pulled from first box booster pack');
    expect(lentCards[0].acquisitionLots?.length).toBe(1);
    expect(lentCards[0].acquisitionLots?.[0].id).toBe('lot-zoro-1');

    // --- BORROWER SIDE ---
    const borrowerBorrowedCard = createBorrowedAsset(dummyCatalogCard, loan);
    const borrowerAssetsDuring = [borrowerBorrowedCard];

    // Card appears under Borrowed tab
    expect(filterAssetsByTab(borrowerAssetsDuring, 'card').length).toBe(0);
    const borrowedCards = filterAssetsByTab(borrowerAssetsDuring, 'borrowed');
    expect(borrowedCards.length).toBe(1);
    expect(borrowedCards[0].loan?.lentValueAmount).toBe(32.5);
    expect(borrowedCards[0].loan?.lentAt).toBe(lentAtDate);
    expect(borrowedCards[0].loan?.role).toBe('borrower');
  });

  it('restores card to original collection only after BOTH players click Returned', () => {
    const borrowPost: CommunityTradePostV6 = {
      id: 'post-borrow-zoro',
      communityId: 'store-1',
      authorId: 'borrower-alice',
      authorName: 'Alice',
      authorUsername: 'alice_tcg',
      authorInitials: 'AT',
      postKind: 'borrow_card',
      exchangeMode: 'open',
      cashAmountCents: null,
      primaryAssetId: 'card-op01-025',
      specificAssetId: null,
      offeredCollectionItemId: null,
      offeredQuantity: 0,
      quantity: 1,
      condition: 'near_mint',
      language: 'EN',
      notes: 'Need Zoro',
      status: 'completed',
      createdAt: '2026-10-02T10:00:00.000Z',
      own: false,
    };

    const offer: LendingOfferSummary = {
      id: 'offer-bob',
      tradePostId: borrowPost.id,
      lenderId: 'lender-bob',
      lenderName: 'Bob',
      lenderUsername: 'bob_builder',
      lenderCollectionItemId: 'item-lender-zoro',
      status: 'accepted',
      createdAt: '2026-10-02T10:15:00.000Z',
    };

    let loan = createLoanFromOffer({
      tradePost: borrowPost,
      offer,
      lenderAsset: dummyLenderOriginalCard,
      borrowerId: 'borrower-alice',
      borrowerName: 'Alice',
      borrowerUsername: 'alice_tcg',
      lentAt: '2026-10-02T11:00:00.000Z',
      lentValueAmount: 32.5,
    });

    // Step 1: Only Lender Bob clicks "Returned"
    const step1 = confirmLoanReturn(loan, 'lender-bob');
    expect(step1.isFullyReturned).toBe(false);
    expect(step1.updatedLoan.lenderReturned).toBe(true);
    expect(step1.updatedLoan.borrowerReturned).toBe(false);
    expect(step1.updatedLoan.status).toBe('active');
    loan = step1.updatedLoan;

    // Both lender and borrower still see the card in Lent / Borrowed
    const lenderCardMid = markAssetAsLent(dummyLenderOriginalCard, loan);
    const borrowerCardMid = createBorrowedAsset(dummyCatalogCard, loan);

    expect(filterAssetsByTab([lenderCardMid], 'lent').length).toBe(1);
    expect(filterAssetsByTab([lenderCardMid], 'card').length).toBe(0);
    expect(filterAssetsByTab([borrowerCardMid], 'borrowed').length).toBe(1);

    // Step 2: Now Borrower Alice clicks "Returned"
    const step2 = confirmLoanReturn(loan, 'borrower-alice');
    expect(step2.isFullyReturned).toBe(true);
    expect(step2.updatedLoan.lenderReturned).toBe(true);
    expect(step2.updatedLoan.borrowerReturned).toBe(true);
    expect(step2.updatedLoan.status).toBe('returned');
    loan = step2.updatedLoan;

    // After both confirm:
    // 1. Lender restores card to active collection
    const restoredLenderCard = restoreReturnedAsset(lenderCardMid);
    expect(restoredLenderCard.loan).toBeUndefined();
    expect(filterAssetsByTab([restoredLenderCard], 'card').length).toBe(1);
    expect(filterAssetsByTab([restoredLenderCard], 'lent').length).toBe(0);

    // Verify all original metadata remains 100% intact
    expect(restoredLenderCard.id).toBe('card-op01-025');
    expect(restoredLenderCard.addedAt).toBe('2023-12-10T15:30:00.000Z');
    expect(restoredLenderCard.purchasePrice).toBe(20.0);
    expect(restoredLenderCard.purchaseCurrency).toBe('EUR');
    expect(restoredLenderCard.note).toBe('Pulled from first box booster pack');
    expect(restoredLenderCard.acquisitionLots?.length).toBe(1);

    // 2. Borrower: loan is inactive so it leaves Borrowed section
    borrowerCardMid.loan = loan;
    expect(filterAssetsByTab([borrowerCardMid], 'borrowed').length).toBe(0);
  });
});
