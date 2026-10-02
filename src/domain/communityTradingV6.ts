export type CommunityTradePostKindV6 = 'offering_card' | 'seeking_card' | 'borrow_card';
export type CommunityTradeExchangeModeV6 = 'money' | 'any_card' | 'specific_card' | 'open';
export type CommunityTradeStatusV6 = 'open' | 'discussing' | 'completed' | 'closed';

export interface CardLoanSummary {
  readonly id: string;
  readonly tradePostId?: string;
  readonly communityId?: string;
  readonly lenderId: string;
  readonly lenderName: string;
  readonly lenderUsername?: string;
  readonly borrowerId: string;
  readonly borrowerName: string;
  readonly borrowerUsername?: string;
  readonly cardVariantId?: string;
  readonly sourceCollectionItemId?: string;
  readonly role: 'lender' | 'borrower';
  readonly otherPartyId: string;
  readonly otherPartyName: string;
  readonly otherPartyUsername?: string;
  readonly lentAt: string;
  readonly lentValueAmount: number;
  readonly lentValueCurrency: string;
  readonly lenderReturned: boolean;
  readonly borrowerReturned: boolean;
  readonly status: 'active' | 'returned';
}

export interface LendingOfferSummary {
  readonly id: string;
  readonly tradePostId: string;
  readonly lenderId: string;
  readonly lenderName: string;
  readonly lenderUsername?: string;
  readonly lenderCollectionItemId?: string;
  readonly offeredCardName?: string;
  readonly condition?: string;
  readonly status: 'offered' | 'accepted' | 'declined' | 'cancelled';
  readonly createdAt: string;
}

export interface CommunityTradeDraftV6 {
  readonly communityId: string;
  readonly postKind: CommunityTradePostKindV6;
  readonly exchangeMode: CommunityTradeExchangeModeV6;
  readonly primaryAssetId: string;
  readonly specificAssetId?: string;
  readonly quantity: number;
  readonly desiredCondition: 'near_mint' | 'excellent' | 'good' | 'light_played' | 'played';
  readonly cashAmountEuros?: string;
  readonly notes?: string;
  readonly allowNegotiation?: boolean;
}

export interface CommunityTradePostV6 {
  readonly id: string;
  readonly communityId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorUsername?: string;
  readonly authorInitials: string;
  readonly postKind: CommunityTradePostKindV6;
  readonly exchangeMode: CommunityTradeExchangeModeV6;
  readonly cashAmountCents: number | null;
  readonly primaryAssetId: string;
  readonly specificAssetId: string | null;
  readonly offeredCollectionItemId: string | null;
  readonly offeredQuantity: number;
  readonly quantity: number;
  readonly condition: string;
  readonly language: string;
  readonly notes: string;
  readonly allowNegotiation?: boolean;
  readonly status: CommunityTradeStatusV6;
  readonly createdAt: string;
  readonly own: boolean;
  readonly lendingOffers?: readonly LendingOfferSummary[];
  readonly loanId?: string;
}

export function activeTradeReservedQuantityV8(
  posts: readonly CommunityTradePostV6[],
  collectionItemId: string | null | undefined,
): number {
  if (!collectionItemId) return 0;
  return posts.reduce((total, post) => (
    post.own
    && (post.status === 'open' || post.status === 'discussing')
    && post.offeredCollectionItemId === collectionItemId
      ? total + post.offeredQuantity
      : total
  ), 0);
}

export function availableTradeQuantityV8(
  ownedQuantity: number,
  collectionItemId: string | null | undefined,
  posts: readonly CommunityTradePostV6[],
): number {
  return Math.max(
    Math.trunc(ownedQuantity) - activeTradeReservedQuantityV8(posts, collectionItemId),
    0,
  );
}

const EUR_INPUT_V6 = /^(?:0|[1-9]\d{0,6})(?:[.,]\d{1,2})?$/;

export function eurosToCentsV6(raw: string | undefined, required: boolean): number | null {
  const value = raw?.trim() ?? '';
  if (!value) {
    if (required) throw new Error('Enter an asking price. Use €0 to give the card away.');
    return null;
  }
  if (!EUR_INPUT_V6.test(value)) {
    throw new Error('Enter a euro amount from €0 to €1,000,000 with at most two decimals.');
  }
  const [euros, decimals = ''] = value.replace(',', '.').split('.');
  const cents = (Number(euros) * 100) + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000) {
    throw new Error('Enter a euro amount from €0 to €1,000,000.');
  }
  return cents;
}

export const FIRM_TERMS_TAG_V6 = '[Firm - No negotiations]';

export function parseTradeNotesAndNegotiationV6(rawNotes: string | null | undefined): {
  readonly notes: string;
  readonly allowNegotiation: boolean;
} {
  const text = rawNotes ?? '';
  const hasFirmTag = text.includes(FIRM_TERMS_TAG_V6);
  const cleanNotes = text.replace(FIRM_TERMS_TAG_V6, '').trim();
  return {
    notes: cleanNotes,
    allowNegotiation: !hasFirmTag,
  };
}

export function validateCommunityTradeDraftV6(draft: CommunityTradeDraftV6): {
  readonly cashAmountCents: number | null;
  readonly notes: string | null;
} {
  if (!draft.communityId) throw new Error('Choose a community.');
  if (!draft.primaryAssetId) {
    throw new Error(draft.postKind === 'offering_card'
      ? 'Choose a card from your collection.'
      : draft.postKind === 'borrow_card'
        ? 'Choose the card you want to borrow.'
        : 'Choose the card you are looking for.');
  }
  if (!Number.isInteger(draft.quantity) || draft.quantity < 1 || draft.quantity > 100_000) {
    throw new Error('Quantity must be a whole number between 1 and 100,000.');
  }
  if (draft.postKind === 'borrow_card') {
    let notes = draft.notes?.trim() || null;
    if (notes && notes.length > 1_000) throw new Error('Keep the post note to 1,000 characters or fewer.');
    if (draft.allowNegotiation === false) {
      notes = notes ? `${notes}\n\n${FIRM_TERMS_TAG_V6}` : FIRM_TERMS_TAG_V6;
    }
    return { cashAmountCents: null, notes };
  }
  if (draft.exchangeMode === 'specific_card') {
    if (!draft.specificAssetId) throw new Error('Choose the specific card for the exchange.');
    if (draft.specificAssetId === draft.primaryAssetId) {
      throw new Error('The two sides of a specific-card trade must be different.');
    }
  } else if (draft.specificAssetId) {
    throw new Error('A specific card can only be attached to the specific-card option.');
  }
  const cashAmountCents = draft.exchangeMode === 'money'
    ? eurosToCentsV6(draft.cashAmountEuros, draft.postKind === 'offering_card')
    : null;
  if (draft.exchangeMode !== 'money' && draft.cashAmountEuros?.trim()) {
    throw new Error('A euro amount can only be attached to the money option.');
  }
  let notes = draft.notes?.trim() || null;
  if (notes && notes.length > 1_000) throw new Error('Keep the post note to 1,000 characters or fewer.');
  if (draft.allowNegotiation === false) {
    notes = notes ? `${notes}\n\n${FIRM_TERMS_TAG_V6}` : FIRM_TERMS_TAG_V6;
  }
  return { cashAmountCents, notes };
}

export function tradeActionLabelV6(post: Pick<
  CommunityTradePostV6,
  'postKind' | 'exchangeMode' | 'cashAmountCents'
>): string {
  if (post.postKind === 'borrow_card') {
    return 'Looking to borrow card';
  }
  if (post.exchangeMode === 'money') {
    if (post.postKind === 'seeking_card' && post.cashAmountCents === null) return 'Looking to buy';
    const amount = new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format((post.cashAmountCents ?? 0) / 100);
    if (post.postKind === 'offering_card' && post.cashAmountCents === 0) return `${amount} · Free giveaway`;
    return post.postKind === 'offering_card' ? `${amount} asking price` : `Budget up to ${amount}`;
  }
  if (post.exchangeMode === 'any_card') {
    return post.postKind === 'offering_card' ? 'Trade for any card' : 'Can trade any owned card';
  }
  if (post.exchangeMode === 'specific_card') {
    return post.postKind === 'offering_card' ? 'Trade for a specific card' : 'Offering a specific card';
  }
  return 'Open to any action';
}

export function initialsV6(name: string): string {
  return name
    .replace(/^@+/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'TH';
}
