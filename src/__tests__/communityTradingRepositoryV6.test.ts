import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DemoAsset } from '../data/demo';
import { SupabaseCommunityTradingRepositoryV6 } from '../services/supabase/communityTradingRepositoryV6';

function ownedCard(overrides: Partial<DemoAsset> = {}): DemoAsset {
  return {
    id: 'card-op01-001-base-en',
    catalogId: 'card-op01-001-base-en',
    collectionItemId: 'collection-item-1',
    kind: 'card',
    name: 'Test Card',
    set: 'Romance Dawn',
    setCode: 'OP01',
    number: 'OP01-001',
    rarity: 'Leader',
    variant: 'Regular art',
    language: 'English',
    condition: 'Near Mint',
    quantity: 2,
    addedAt: '2026-07-24T00:00:00.000Z',
    color: 'red',
    quote: { cardmarket: 1, tcgplayer: 1 },
    change: {
      cardmarket: { '1D': null, '1W': null, '1M': null },
      tcgplayer: { '1D': null, '1W': null, '1M': null },
    },
    ...overrides,
  };
}

describe('Supabase community trading repository v6', () => {
  it('creates a zero-euro giveaway through the atomic RPC using the owned collection row', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'trade-post-1', error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null }) },
      rpc,
      from: vi.fn(),
    } as unknown as SupabaseClient;
    const repository = new SupabaseCommunityTradingRepositoryV6(client);

    await repository.create({
      communityId: 'community-1',
      postKind: 'offering_card',
      exchangeMode: 'money',
      primaryAssetId: 'card-op01-001-base-en',
      quantity: 1,
      desiredCondition: 'near_mint',
      cashAmountEuros: '0',
      notes: 'Free to a local player.',
    }, [ownedCard()], [ownedCard()], 'owner-1');

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('create_community_trade_post_v6', expect.objectContaining({
      p_community_id: 'community-1',
      p_post_kind: 'offering_card',
      p_exchange_mode: 'money',
      p_primary_collection_item_id: 'collection-item-1',
      p_primary_card_variant_id: null,
      p_cash_amount_cents: 0,
      p_notes: 'Free to a local player.',
    }));
  });

  it('fails before mutation when the active session belongs to another account', async () => {
    const rpc = vi.fn();
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-2' } }, error: null }) },
      rpc,
      from: vi.fn(),
    } as unknown as SupabaseClient;
    const repository = new SupabaseCommunityTradingRepositoryV6(client);

    await expect(repository.create({
      communityId: 'community-1',
      postKind: 'offering_card',
      exchangeMode: 'money',
      primaryAssetId: 'card-op01-001-base-en',
      quantity: 1,
      desiredCondition: 'near_mint',
      cashAmountEuros: '10',
    }, [ownedCard()], [ownedCard()], 'owner-1')).rejects.toThrow(/different account/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never allows a German-language card into an offer', async () => {
    const rpc = vi.fn();
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null }) },
      rpc,
      from: vi.fn(),
    } as unknown as SupabaseClient;
    const repository = new SupabaseCommunityTradingRepositoryV6(client);

    await expect(repository.create({
      communityId: 'community-1',
      postKind: 'offering_card',
      exchangeMode: 'open',
      primaryAssetId: 'card-op01-001-base-de',
      quantity: 1,
      desiredCondition: 'near_mint',
    }, [ownedCard({ id: 'card-op01-001-base-de', language: 'German' })], [], 'owner-1'))
      .rejects.toThrow(/German/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});
