import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('card borrowing and lending migration', () => {
  it('includes trade_posts_post_kind constraint update, tables, and RPCs', () => {
    const migration = readFileSync(
      new URL('../../supabase/migrations/20261002180000_card_borrowing_and_lending.sql', import.meta.url),
      'utf8',
    );

    expect(migration).toMatch(/post_kind\s+in\s+\('offering_card',\s*'seeking_card',\s*'borrow_card'\)/i);
    expect(migration).toMatch(/create\s+table\s+if\s+not\s+exists\s+public\.community_card_lending_offers/i);
    expect(migration).toMatch(/create\s+table\s+if\s+not\s+exists\s+public\.community_card_loans/i);
    expect(migration).toMatch(/create\s+or\s+replace\s+function\s+public\.offer_to_lend_card_v1/i);
    expect(migration).toMatch(/create\s+or\s+replace\s+function\s+public\.accept_lending_offer_v1/i);
    expect(migration).toMatch(/create\s+or\s+replace\s+function\s+public\.confirm_card_return_v1/i);
    expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+public\.offer_to_lend_card_v1/i);
    expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+public\.accept_lending_offer_v1/i);
    expect(migration).toMatch(/grant\s+execute\s+on\s+function\s+public\.confirm_card_return_v1/i);
  });
});
