import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  activeTradeReservedQuantityV8,
  availableTradeQuantityV8,
  type CommunityTradePostV6,
} from '../domain/communityTradingV6';

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20260724150826_unique_active_trade_reservations_v8.sql',
  import.meta.url,
)), 'utf8');
const board = readFileSync(fileURLToPath(new URL(
  '../components/CommunityTradingBoardV6.tsx',
  import.meta.url,
)), 'utf8');

function post(
  id: string,
  status: CommunityTradePostV6['status'],
  offeredQuantity: number,
  collectionItemId = 'collection-item-1',
): CommunityTradePostV6 {
  return {
    id,
    communityId: 'community-1',
    authorId: 'owner-1',
    authorName: 'Owner',
    authorInitials: 'O',
    postKind: 'offering_card',
    exchangeMode: 'open',
    cashAmountCents: null,
    primaryAssetId: 'card-1',
    specificAssetId: null,
    offeredCollectionItemId: collectionItemId,
    offeredQuantity,
    quantity: offeredQuantity,
    condition: 'near_mint',
    language: 'EN',
    notes: '',
    status,
    createdAt: '2026-07-24T00:00:00.000Z',
    own: true,
  };
}

describe('unique physical-card trade reservations v8', () => {
  it('counts only the signed-in owner’s open and discussing reservations', () => {
    const anotherMember = { ...post('other', 'open', 9), own: false };
    const posts = [
      post('open', 'open', 1),
      post('discussing', 'discussing', 2),
      post('completed', 'completed', 4),
      post('closed', 'closed', 8),
      anotherMember,
    ];

    expect(activeTradeReservedQuantityV8(posts, 'collection-item-1')).toBe(3);
    expect(availableTradeQuantityV8(5, 'collection-item-1', posts)).toBe(2);
    expect(availableTradeQuantityV8(1, 'collection-item-1', posts)).toBe(0);
  });

  it('serializes and rejects reservations above the owned physical quantity', () => {
    expect(migration).toContain('for update');
    expect(migration).toContain('private.active_trade_reserved_quantity_v8');
    expect(migration).toContain('Only % unreserved copies of this card are available');
    expect(migration).toContain('collection_trade_reservation_guard_v8');
    expect(migration).toContain("post.status in ('open', 'discussing')");
  });

  it('consumes inventory exactly once on completion and keeps terminal posts immutable', () => {
    expect(migration).toContain('trade_completed_inventory_consume_v8');
    expect(migration).toContain("if new.status <> 'completed' or old.status = 'completed'");
    expect(migration).toContain('set quantity = quantity - v_offered.quantity');
    expect(migration).toContain('set deleted_at = transaction_timestamp()');
    expect(migration).toContain('trade_post_lifecycle_guard_v8');
    expect(migration).toContain('Completed and closed trades are immutable history');
    expect(migration).toContain('Only the trade author may complete a trade');
  });

  it('defaults the board to active trades and removes fully reserved cards from the picker', () => {
    expect(board).toContain("useState<CommunityTradeStatusV6 | 'active' | 'all'>('active')");
    expect(board).toContain('<option value="active">Active trades</option>');
    expect(board).toContain('availableTradeQuantityV8');
    expect(board).toContain('Every owned card is already reserved');
    expect(board).toContain('Completed and closed posts do not reserve cards');
  });
});
