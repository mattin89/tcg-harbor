import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  activitiesForOwnerV3,
  mapActivityRowsForOwnerV3,
  SupabaseActivityRepositoryV3,
  type ActivityRowV3,
} from '../services/supabase/activityRepositoryV3';

const now = Date.parse('2026-07-23T14:30:00.000Z');

function activityRow(overrides: Partial<ActivityRowV3> = {}): ActivityRowV3 {
  return {
    id: 101,
    user_id: 'account-a',
    activity_type: 'collection_item_added',
    entity_type: 'collection_item',
    entity_id: 'item-a',
    metadata: {
      asset_kind: 'card',
      asset_name: 'Monkey.D.Luffy',
      card_number: 'P-041',
      set_code: 'P',
      variant_name: 'Championship 2023',
      language: 'EN',
      added_quantity: 2,
      quantity_after: 2,
      collection_acquisition_lot_id: '77',
    },
    occurred_at: '2026-07-23T14:18:00.000Z',
    ...overrides,
  };
}

describe('production recent activity v3', () => {
  it('maps an acquisition log to a useful card activity entry', () => {
    expect(mapActivityRowsForOwnerV3([activityRow()], 'account-a', now)).toEqual([{
      id: '101',
      ownerId: 'account-a',
      icon: 'plus',
      title: 'Added Monkey.D.Luffy',
      detail: 'P-041 · Championship 2023 · EN · +2 copies',
      createdAt: '2026-07-23T14:18:00.000Z',
      time: '12 min ago',
    }]);
  });

  it('fails closed when any returned row belongs to another account', () => {
    expect(() => mapActivityRowsForOwnerV3([
      activityRow(),
      activityRow({ id: 102, user_id: 'account-b' }),
    ], 'account-a', now)).toThrow(/another account/i);
  });

  it('never renders a snapshot after the active account changes', () => {
    const activities = mapActivityRowsForOwnerV3([activityRow()], 'account-a', now);
    const snapshot = { ownerId: 'account-a', activities };
    expect(activitiesForOwnerV3(snapshot, 'account-a')).toEqual(activities);
    expect(activitiesForOwnerV3(snapshot, 'account-b')).toEqual([]);
    expect(activitiesForOwnerV3(snapshot, null)).toEqual([]);
  });

  it('verifies and explicitly filters the owner before loading the newest 20 rows', async () => {
    const filters: Array<[string, unknown]> = [];
    const orders: Array<[string, boolean | undefined]> = [];
    let selected = '';
    let requestedRange: [number, number] | null = null;
    const query = {
      select(columns: string) {
        selected = columns;
        return this;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return this;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orders.push([column, options?.ascending]);
        return this;
      },
      range(from: number, to: number) {
        requestedRange = [from, to];
        return Promise.resolve({ data: [activityRow()], error: null });
      },
    };
    const client = {
      auth: {
        getUser() {
          return Promise.resolve({ data: { user: { id: 'account-a' } }, error: null });
        },
      },
      from(table: string) {
        expect(table).toBe('activity_logs');
        return query;
      },
    } as unknown as SupabaseClient;

    const snapshot = await new SupabaseActivityRepositoryV3(client).load('account-a', now);

    expect(snapshot.ownerId).toBe('account-a');
    expect(snapshot.activities).toHaveLength(1);
    expect(selected).toContain('user_id');
    expect(filters).toEqual([['user_id', 'account-a']]);
    expect(orders).toEqual([
      ['occurred_at', false],
      ['id', false],
    ]);
    expect(requestedRange).toEqual([0, 19]);
  });
});
